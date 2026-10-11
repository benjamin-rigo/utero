/** Same codes as Cond::from_code in crates/core/src/seq.rs. */
export type CondCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface StepState {
  trig: boolean
  vel: number
  prob: number
  cond: CondCode
  a: number
  b: number
  /** 1/24 of a step, −11..11 */
  micro: number
  /** MIDI note, 41 = F2 */
  note: number
}

export interface TrackState {
  name: string
  bus: string
  length: number
  speed: number
  steps: StepState[]
  params: number[]
}

/** 0 OFF, 1 LFO, 2 NOISE, 3 STEP (ModKind::from_code). */
export type ModKind = 0 | 1 | 2 | 3

export interface ModulatorState {
  kind: ModKind
  /** Shape::from_code: 0 SIN 1 GLIDE 2 S&H 3 TRI 4 SAW 5 RAMP 6 SQR 7 EXP 8 DRIFT */
  shape: number
  /** NoiseColor::from_code: 0 WHITE 1 PINK 2 CRACKLE */
  color: number
  sync: boolean
  rateIndex: number
  hz: number
  phase: number
  bipolar: boolean
  /** TrigMode::from_code: 0 FREE 1 RETRIG 2 ONESHOT */
  trigMode: number
  /** track index, −1 = none */
  trigSrc: number
  smooth: number
  depth: number
  steps: number[]
  stepLen: number
}

export interface RouteState {
  src: number
  track: number
  param: number
  /** −1..1 */
  amount: number
}

export interface MacroTargetState {
  /** row (0–11 track, 12–19 bus, 20 master) */
  track: number
  param: number
  a: number
  b: number
  /** engine target slot 0–15, stable for the target's lifetime */
  slot: number
}

export interface MacroState {
  name: string
  pos: number
  targets: MacroTargetState[]
}

export interface LearnState {
  macro: number
  side: 'a' | 'b'
}

export interface AppState {
  bpm: number
  playing: boolean
  selected: number
  tracks: TrackState[]
  modulators: ModulatorState[]
  /** index = engine route slot */
  routes: (RouteState | null)[]
  macros: MacroState[]
  selectedMod: number
  selectedMacro: number
  learn: LearnState | null
  buses: BusState[]
  master: MasterState
  muteQuantize: boolean
  editMode: 'trig' | 'note'
}

export interface BusState {
  name: string
  params: number[]
  muted: boolean
}

export interface MasterState {
  params: number[]
}
