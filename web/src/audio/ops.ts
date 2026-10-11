import type { StepState } from '@/state/types'

export const Op = { SetParam: 1, SetStep: 2, SetLength: 3, SetSpeed: 4, Play: 5, Stop: 6, SetBpm: 7, SetFill: 8 } as const
export const CMD_WORDS = 10

export const cmdSetParam = (t: number, p: number, v: number) => [Op.SetParam, t, p, v]
export const cmdSetStep = (t: number, s: number, st: StepState) =>
  [Op.SetStep, t, s, st.trig ? 1 : 0, st.vel, st.prob, st.cond, st.a, st.b, st.micro]
export const cmdSetLength = (t: number, len: number) => [Op.SetLength, t, len]
export const cmdSetSpeed = (t: number, code: number) => [Op.SetSpeed, t, code]
export const cmdPlay = () => [Op.Play]
export const cmdStop = () => [Op.Stop]
export const cmdSetBpm = (bpm: number) => [Op.SetBpm, bpm]
export const cmdSetFill = (on: boolean) => [Op.SetFill, on ? 1 : 0]
