import { cmdPlay, cmdSetBpm, cmdSetLength, cmdSetParam, cmdSetSpeed, cmdSetStep, cmdStop } from '@/audio/ops'
import { KICK_PARAMS } from './kickParams'
import type { AppState, StepState, TrackState } from './types'

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
  return { bpm: 128, playing: false, selected: 0, tracks }
}

type Send = (cmd: number[]) => void

export function createStore(initial: AppState = initialState()) {
  let state = initial
  let send: Send = () => {}
  const listeners = new Set<() => void>()

  const set = (next: AppState) => {
    state = next
    listeners.forEach((l) => l())
  }
  const updateTrack = (t: number, fn: (tr: TrackState) => TrackState) =>
    set({ ...state, tracks: state.tracks.map((tr, i) => (i === t ? fn(tr) : tr)) })

  const syncAll = () => {
    send(cmdSetBpm(state.bpm))
    state.tracks.forEach((tr, t) => {
      send(cmdSetLength(t, tr.length))
      send(cmdSetSpeed(t, tr.speed))
      tr.steps.forEach((st, s) => { if (!isDefault(st)) send(cmdSetStep(t, s, st)) })
      tr.params.forEach((v, p) => send(cmdSetParam(t, p, v)))
    })
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
    setParam(t: number, p: number, v: number) {
      const value = clamp(v, 0, 1)
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
  }
}

export type Store = ReturnType<typeof createStore>
