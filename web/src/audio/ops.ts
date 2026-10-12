import type { MacroTargetState, ModulatorState, RouteState, StepState } from '@/state/types'

export const Op = {
  SetParam: 1, SetStep: 2, SetLength: 3, SetSpeed: 4, Play: 5, Stop: 6, SetBpm: 7, SetFill: 8,
  SetModulator: 9, SetModStep: 10, SetModStepLen: 11, SetRoute: 12, ClearRoute: 13,
  SetMacroTarget: 14, ClearMacroTarget: 15, SetMacroPos: 16, SetBusMute: 17, SetFxOrder: 18,
} as const
export const CMD_WORDS = 16

export const cmdSetParam = (t: number, p: number, v: number) => [Op.SetParam, t, p, v]
export const cmdSetStep = (t: number, s: number, st: StepState) =>
  [Op.SetStep, t, s, st.trig ? 1 : 0, st.vel, st.prob, st.cond, st.a, st.b, st.micro, st.note]
export const cmdSetLength = (t: number, len: number) => [Op.SetLength, t, len]
export const cmdSetSpeed = (t: number, code: number) => [Op.SetSpeed, t, code]
export const cmdPlay = () => [Op.Play]
export const cmdStop = () => [Op.Stop]
export const cmdSetBpm = (bpm: number) => [Op.SetBpm, bpm]
export const cmdSetFill = (on: boolean) => [Op.SetFill, on ? 1 : 0]
export const cmdSetModulator = (slot: number, m: ModulatorState) => [
  Op.SetModulator, slot, m.kind, m.shape, m.color, m.sync ? 1 : 0, m.rateIndex, m.hz, m.phase,
  m.bipolar ? 1 : 0, m.trigMode, m.trigSrc, m.smooth, m.depth,
]
export const cmdSetModStep = (slot: number, i: number, v: number) => [Op.SetModStep, slot, i, v]
export const cmdSetModStepLen = (slot: number, len: number) => [Op.SetModStepLen, slot, len]
export const cmdSetRoute = (index: number, r: RouteState) => [Op.SetRoute, index, r.src, r.track, r.param, r.amount]
export const cmdClearRoute = (index: number) => [Op.ClearRoute, index]
export const cmdSetMacroTarget = (m: number, i: number, t: MacroTargetState) => [Op.SetMacroTarget, m, i, t.track, t.param, t.a, t.b]
export const cmdClearMacroTarget = (m: number, i: number) => [Op.ClearMacroTarget, m, i]
export const cmdSetMacroPos = (m: number, pos: number) => [Op.SetMacroPos, m, pos]
export const cmdSetFxOrder = (track: number, order: number[]) => [Op.SetFxOrder, track, ...order]
export const cmdSetBusMute = (bus: number, muted: boolean, quantized: boolean) => [Op.SetBusMute, bus, muted ? 1 : 0, quantized ? 1 : 0]
