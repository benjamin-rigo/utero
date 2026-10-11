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
}

export interface TrackState {
  name: string
  bus: string
  length: number
  speed: number
  steps: StepState[]
  params: number[]
}

export interface AppState {
  bpm: number
  playing: boolean
  selected: number
  tracks: TrackState[]
}
