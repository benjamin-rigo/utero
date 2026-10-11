import {
  cmdClearMacroTarget, cmdClearRoute, cmdPlay, cmdSetBpm, cmdSetLength, cmdSetMacroPos, cmdSetMacroTarget,
  cmdSetModStep, cmdSetModStepLen, cmdSetModulator, cmdSetParam, cmdSetRoute, cmdSetSpeed, cmdSetStep, cmdStop,
} from '@/audio/ops'
import { KICK_PARAMS } from './kickParams'
import { initialMacros, initialModulators, MACRO_TARGETS, MAX_ROUTES, STEP_COUNT } from './modulation'
import type { AppState, MacroState, ModulatorState, StepState, TrackState } from './types'

export const KICK_TRACKS = 2

const TRACK_DEFS: [name: string, bus: string][] = [
  ['KICK', 'KICK'], ['KCK2', 'KICK'], ['HH', 'HATS'], ['OH', 'HATS'], ['SNR', 'PERC'], ['NOIS', 'PERC'], ['SMPL', 'PERC'],
  ['SUB', 'BASS'], ['MID', 'BASS'], ['LD1', 'LEAD'], ['LD2', 'LEAD'], ['PAD', 'PAD'], ['ORN', 'ORN'],
]

const emptyStep = (): StepState => ({ trig: false, vel: 1, prob: 100, cond: 0, a: 1, b: 2, micro: 0 })
const isDefault = (s: StepState) => !s.trig && s.vel === 1 && s.prob === 100 && s.cond === 0 && s.micro === 0
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function initialState(): AppState {
  const tracks: TrackState[] = TRACK_DEFS.map(([name, bus], i) => ({
    name,
    bus,
    length: 16,
    speed: 1,
    steps: Array.from({ length: 64 }, emptyStep),
    params: i < KICK_TRACKS ? KICK_PARAMS.map((p) => p.default) : [],
  }))
  for (const s of [0, 4, 8, 12]) tracks[0].steps[s].trig = true
  return {
    bpm: 128, playing: false, selected: 0, tracks,
    modulators: initialModulators(), routes: Array(MAX_ROUTES).fill(null), macros: initialMacros(),
    selectedMod: 0, selectedMacro: 0, learn: null,
  }
}

/** Base value with macro overrides applied (later macro wins), without modulation. */
export function effectiveValue(state: AppState, t: number, p: number): number {
  let v = state.tracks[t].params[p] ?? 0
  for (const m of state.macros) {
    for (const x of m.targets) if (x.track === t && x.param === p) v = x.a + (x.b - x.a) * m.pos
  }
  return v
}

export function modAmountFor(state: AppState, t: number, p: number): number {
  return state.routes.reduce((sum, r) => (r && r.track === t && r.param === p ? sum + r.amount : sum), 0)
}

export function routeIndexFor(state: AppState, src: number, t: number, p: number): number {
  return state.routes.findIndex((r) => r !== null && r.src === src && r.track === t && r.param === p)
}

type Send = (cmd: number[]) => void
type ModulatorPatch = Partial<Omit<ModulatorState, 'steps'>>

export function createStore(initial: AppState = initialState()) {
  let state = initial
  let send: Send = () => {}
  let nextRoute = 0
  const listeners = new Set<() => void>()

  const set = (next: AppState) => {
    state = next
    listeners.forEach((l) => l())
  }
  const updateTrack = (t: number, fn: (tr: TrackState) => TrackState) =>
    set({ ...state, tracks: state.tracks.map((tr, i) => (i === t ? fn(tr) : tr)) })
  const updateMacro = (m: number, fn: (mac: MacroState) => MacroState) =>
    set({ ...state, macros: state.macros.map((x, i) => (i === m ? fn(x) : x)) })
  const updateMod = (slot: number, next: ModulatorState) =>
    set({ ...state, modulators: state.modulators.map((x, i) => (i === slot ? next : x)) })

  const syncAll = () => {
    send(cmdSetBpm(state.bpm))
    state.tracks.forEach((tr, t) => {
      send(cmdSetLength(t, tr.length))
      send(cmdSetSpeed(t, tr.speed))
      tr.steps.forEach((st, s) => { if (!isDefault(st)) send(cmdSetStep(t, s, st)) })
      tr.params.forEach((v, p) => send(cmdSetParam(t, p, v)))
    })
    state.modulators.forEach((m, slot) => {
      send(cmdSetModulator(slot, m))
      m.steps.forEach((v, i) => { if (v !== 0) send(cmdSetModStep(slot, i, v)) })
      if (m.stepLen !== STEP_COUNT) send(cmdSetModStepLen(slot, m.stepLen))
    })
    state.routes.forEach((r, i) => { if (r) send(cmdSetRoute(i, r)) })
    state.macros.forEach((mac, m) => {
      mac.targets.forEach((t, i) => send(cmdSetMacroTarget(m, i, t)))
      send(cmdSetMacroPos(m, mac.pos))
    })
  }

  const setRoute = (index: number, amount: number) => {
    const r = state.routes[index]
    if (!r) return
    const next = { ...r, amount: clamp(amount, -1, 1) }
    set({ ...state, routes: state.routes.map((x, i) => (i === index ? next : x)) })
    send(cmdSetRoute(index, next))
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    connect(next: Send) {
      send = next
      syncAll()
    },
    toggleStep(t: number, s: number) {
      const step = { ...state.tracks[t].steps[s], trig: !state.tracks[t].steps[s].trig }
      updateTrack(t, (tr) => ({ ...tr, steps: tr.steps.map((st, i) => (i === s ? step : st)) }))
      send(cmdSetStep(t, s, step))
    },
    setLength(t: number, len: number) {
      const length = clamp(Math.round(len), 1, 64)
      updateTrack(t, (tr) => ({ ...tr, length }))
      send(cmdSetLength(t, length))
    },
    setSpeed(t: number, code: number) {
      updateTrack(t, (tr) => ({ ...tr, speed: code }))
      send(cmdSetSpeed(t, code))
    },
    /** While LEARN is armed this writes the macro endpoint instead of the base value. */
    setParam(t: number, p: number, v: number) {
      const value = clamp(v, 0, 1)
      const learn = state.learn
      if (learn) {
        const mac = state.macros[learn.macro]
        let idx = mac.targets.findIndex((x) => x.track === t && x.param === p)
        const base = state.tracks[t].params[p]
        if (idx === -1) {
          if (mac.targets.length >= MACRO_TARGETS) return
          idx = mac.targets.length
        }
        const prev = mac.targets[idx] ?? { track: t, param: p, a: base, b: base }
        const target = { ...prev, [learn.side]: value }
        updateMacro(learn.macro, (x) => ({
          ...x,
          targets: idx < x.targets.length ? x.targets.map((y, i) => (i === idx ? target : y)) : [...x.targets, target],
        }))
        send(cmdSetMacroTarget(learn.macro, idx, target))
        return
      }
      updateTrack(t, (tr) => ({ ...tr, params: tr.params.map((x, i) => (i === p ? value : x)) }))
      send(cmdSetParam(t, p, value))
    },
    setBpm(bpm: number) {
      if (!Number.isFinite(bpm)) return
      const next = clamp(bpm, 20, 300)
      set({ ...state, bpm: next })
      send(cmdSetBpm(next))
    },
    play() {
      set({ ...state, playing: true })
      send(cmdPlay())
    },
    stop() {
      set({ ...state, playing: false })
      send(cmdStop())
    },
    select(t: number) {
      set({ ...state, selected: t })
    },
    selectMod(slot: number) {
      set({ ...state, selectedMod: slot })
    },
    updateModulator(slot: number, patch: ModulatorPatch) {
      const next = { ...state.modulators[slot], ...patch }
      updateMod(slot, next)
      send(cmdSetModulator(slot, next))
      if (patch.stepLen !== undefined) send(cmdSetModStepLen(slot, next.stepLen))
    },
    setModStep(slot: number, i: number, v: number) {
      const value = clamp(v, -1, 1)
      const m = state.modulators[slot]
      updateMod(slot, { ...m, steps: m.steps.map((x, k) => (k === i ? value : x)) })
      send(cmdSetModStep(slot, i, value))
    },
    addRoute(src: number, t: number, p: number, amount = 0.25): number {
      const existing = routeIndexFor(state, src, t, p)
      if (existing !== -1) return existing
      let index = -1
      for (let k = 0; k < MAX_ROUTES; k++) {
        const i = (nextRoute + k) % MAX_ROUTES
        if (state.routes[i] === null) { index = i; break }
      }
      if (index === -1) return -1
      nextRoute = (index + 1) % MAX_ROUTES
      const route = { src, track: t, param: p, amount: clamp(amount, -1, 1) }
      set({ ...state, routes: state.routes.map((r, i) => (i === index ? route : r)) })
      send(cmdSetRoute(index, route))
      return index
    },
    setRouteAmount(index: number, amount: number) {
      setRoute(index, amount)
    },
    removeRoute(index: number) {
      if (!state.routes[index]) return
      set({ ...state, routes: state.routes.map((r, i) => (i === index ? null : r)) })
      send(cmdClearRoute(index))
    },
    selectMacro(m: number) {
      set({ ...state, selectedMacro: m })
    },
    setMacroPos(m: number, pos: number) {
      const value = clamp(pos, 0, 1)
      updateMacro(m, (x) => ({ ...x, pos: value }))
      send(cmdSetMacroPos(m, value))
    },
    armLearn(m: number, side: 'a' | 'b') {
      if (state.learn?.macro === m && state.learn.side === side) {
        set({ ...state, learn: null })
        return
      }
      const pos = side === 'a' ? 0 : 1
      set({
        ...state,
        learn: { macro: m, side },
        selectedMacro: m,
        macros: state.macros.map((x, i) => (i === m ? { ...x, pos } : x)),
      })
      send(cmdSetMacroPos(m, pos))
    },
    renameMacro(m: number, name: string) {
      const trimmed = name.trim()
      if (trimmed) updateMacro(m, (x) => ({ ...x, name: trimmed }))
    },
    removeMacroTarget(m: number, i: number) {
      const old = state.macros[m].targets
      if (i < 0 || i >= old.length) return
      const next = old.filter((_, k) => k !== i)
      updateMacro(m, (x) => ({ ...x, targets: next }))
      // Engine slots mirror array indices: resend the shifted tail, clear the freed last slot.
      for (let k = i; k < next.length; k++) send(cmdSetMacroTarget(m, k, next[k]))
      send(cmdClearMacroTarget(m, old.length - 1))
    },
  }
}


export type Store = ReturnType<typeof createStore>
