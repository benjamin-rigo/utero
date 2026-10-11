import {
  cmdClearMacroTarget, cmdClearRoute, cmdPlay, cmdSetBpm, cmdSetLength, cmdSetMacroPos, cmdSetMacroTarget,
  cmdSetModStep, cmdSetModStepLen, cmdSetModulator, cmdSetParam, cmdSetRoute, cmdSetSpeed, cmdSetStep, cmdStop, cmdSetBusMute,
} from '@/audio/ops'
import { BUS_NAMES, BUS_PARAMS, isMelodic, MACHINES, MASTER_PARAMS, MASTER_ROW, rowParamMetas, TRACK_COUNT } from './machines'
import { initialMacros, initialModulators, MACRO_TARGETS, MAX_ROUTES, STEP_COUNT } from './modulation'
import type { AppState, BusState, MacroState, MacroTargetState, ModulatorState, StepState, TrackState } from './types'

export const KICK_TRACKS = 2

const TRACK_DEFS: [name: string, bus: string][] = [
  ['KICK', 'KICK'], ['KCK2', 'KICK'], ['HH', 'HATS'], ['OH', 'HATS'], ['SNR', 'PERC'], ['NOIS', 'PERC'], ['SMPL', 'PERC'],
  ['SUB', 'BASS'], ['MID', 'BASS'], ['LD1', 'LEAD'], ['LD2', 'LEAD'], ['PAD', 'PAD'], ['ORN', 'ORN'],
]

const emptyStep = (): StepState => ({ trig: false, vel: 1, prob: 100, cond: 0, a: 1, b: 2, micro: 0, note: 41 })
const isDefault = (s: StepState) => !s.trig && s.vel === 1 && s.prob === 100 && s.cond === 0 && s.micro === 0 && s.note === 41
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function initialState(): AppState {
  const tracks: TrackState[] = TRACK_DEFS.map(([name, bus], i) => ({
    name,
    bus,
    length: 16,
    speed: 1,
    steps: Array.from({ length: 64 }, emptyStep),
    params: MACHINES[i]?.params.map((p) => p.default) ?? [],
  }))
  for (const s of [0, 4, 8, 12]) tracks[0].steps[s].trig = true
  return {
    bpm: 128, playing: false, selected: 0, tracks,
    modulators: initialModulators(), routes: Array(MAX_ROUTES).fill(null), macros: initialMacros(),
    selectedMod: 0, selectedMacro: 0, learn: null,
    buses: BUS_NAMES.map((name): BusState => ({ name, params: BUS_PARAMS.map((p) => p.default), muted: false })),
    master: { params: MASTER_PARAMS.map((p) => p.default) },
    muteQuantize: true,
    editMode: 'trig',
  }
}

/** Base value with macro overrides applied (later macro wins), without modulation. */
export function rowParams(state: AppState, row: number): number[] {
  if (row < TRACK_COUNT) return state.tracks[row]?.params ?? []
  if (row < MASTER_ROW) return state.buses[row - TRACK_COUNT]?.params ?? []
  return row === MASTER_ROW ? state.master.params : []
}

/** Base value of any row with macro overrides applied (later macro wins), without modulation. */
export function effectiveValue(state: AppState, row: number, p: number): number {
  let v = rowParams(state, row)[p] ?? 0
  for (const m of state.macros) {
    for (const x of m.targets) if (x.track === row && x.param === p) v = x.a + (x.b - x.a) * m.pos
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
  const updateRow = (row: number, fn: (params: number[]) => number[]) => {
    if (row < TRACK_COUNT) updateTrack(row, (tr) => ({ ...tr, params: fn(tr.params) }))
    else if (row < MASTER_ROW) set({ ...state, buses: state.buses.map((b, i) => (i === row - TRACK_COUNT ? { ...b, params: fn(b.params) } : b)) })
    else set({ ...state, master: { params: fn(state.master.params) } })
  }
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
    state.buses.forEach((b, i) => {
      b.params.forEach((v, p) => send(cmdSetParam(TRACK_COUNT + i, p, v)))
      send(cmdSetBusMute(i, b.muted, false))
    })
    state.master.params.forEach((v, p) => send(cmdSetParam(MASTER_ROW, p, v)))
    state.modulators.forEach((m, slot) => {
      send(cmdSetModulator(slot, m))
      m.steps.forEach((v, i) => { if (v !== 0) send(cmdSetModStep(slot, i, v)) })
      if (m.stepLen !== STEP_COUNT) send(cmdSetModStepLen(slot, m.stepLen))
    })
    state.routes.forEach((r, i) => { if (r) send(cmdSetRoute(i, r)) })
    state.macros.forEach((mac, m) => {
      mac.targets.forEach((t) => send(cmdSetMacroTarget(m, t.slot, t)))
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
    /** `t` is a row: 0–12 track, 13–20 bus, 21 master. */
    setParam(t: number, p: number, v: number) {
      if (p >= rowParamMetas(t).length) return
      const value = clamp(v, 0, 1)
      const learn = state.learn
      if (learn) {
        const mac = state.macros[learn.macro]
        const existing = mac.targets.find((x) => x.track === t && x.param === p)
        const base = rowParams(state, t)[p]
        let target: MacroTargetState
        if (existing) {
          target = { ...existing, [learn.side]: value }
        } else {
          const used = new Set(mac.targets.map((x) => x.slot))
          const slot = Array.from({ length: MACRO_TARGETS }, (_, k) => k).find((k) => !used.has(k))
          if (slot === undefined) return
          target = { track: t, param: p, a: base, b: base, slot, [learn.side]: value }
        }
        updateMacro(learn.macro, (x) => ({
          ...x,
          targets: existing ? x.targets.map((y) => (y === existing ? target : y)) : [...x.targets, target],
        }))
        send(cmdSetMacroTarget(learn.macro, target.slot, target))
        return
      }
      updateRow(t, (params) => params.map((x, i) => (i === p ? value : x)))
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
    setStepNote(t: number, s: number, note: number) {
      if (!isMelodic(t)) return
      const step = { ...state.tracks[t].steps[s], note: clamp(Math.round(note), 0, 127) }
      updateTrack(t, (tr) => ({ ...tr, steps: tr.steps.map((st, i) => (i === s ? step : st)) }))
      send(cmdSetStep(t, s, step))
    },
    setEditMode(mode: 'trig' | 'note') {
      set({ ...state, editMode: mode })
    },
    toggleMute(b: number) {
      const muted = !state.buses[b].muted
      set({ ...state, buses: state.buses.map((x, i) => (i === b ? { ...x, muted } : x)) })
      send(cmdSetBusMute(b, muted, state.muteQuantize && state.playing))
    },
    setMuteQuantize(on: boolean) {
      set({ ...state, muteQuantize: on })
    },
    selectMod(slot: number) {
      set({ ...state, selectedMod: slot })
    },
    updateModulator(slot: number, patch: ModulatorPatch) {
      const { hz, ...rest } = patch
      const next = { ...state.modulators[slot], ...rest }
      if (hz !== undefined && Number.isFinite(hz)) next.hz = clamp(hz, 0.01, 40)
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
      const removed = state.macros[m].targets[i]
      if (!removed) return
      updateMacro(m, (x) => ({ ...x, targets: x.targets.filter((_, k) => k !== i) }))
      // Engine slots are stable: only the removed target's slot fades out.
      send(cmdClearMacroTarget(m, removed.slot))
    },
  }
}


export type Store = ReturnType<typeof createStore>
