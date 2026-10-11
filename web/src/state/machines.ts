import { KICK_PAGES, KICK_PARAMS, type ParamMeta } from './kickParams'

export interface Page {
  name: string
  params: number[]
}

export interface MachineDef {
  name: string
  melodic: boolean
  params: ParamMeta[]
  pages: Page[]
}

const meta = (pairs: [string, number][]): ParamMeta[] => pairs.map(([name, d]) => ({ name, default: d }))

/** Mirrors SUB_PARAMS in crates/core/src/sub.rs. */
export const SUB_PARAMS = meta([['OCT', 0.5], ['PHASE', 0], ['DRIVE', 0.1], ['GLIDE', 0], ['DECAY', 0.6], ['DRIFT', 0.2], ['LEVEL', 0.8], ['ROUTE', 0]])
/** Mirrors MID_PARAMS in crates/core/src/mid.rs. */
export const MID_PARAMS = meta([
  ['WAVE', 0], ['DETUNE', 0.3], ['FOLD', 0], ['NOISE', 0.05], ['DRIFT', 0.2], ['OCT', 0.5], ['GLIDE', 0], ['LINK', 0],
  ['CUTOFF', 0.45], ['RES', 0.3], ['ENV AMT', 0.5], ['F.DECAY', 0.4], ['DRIVE', 0.2], ['KEYTRK', 0.5], ['TYPE', 0], ['LEVEL', 0.7],
  ['A.DECAY', 0.5],
])
/** Mirrors BUS_PARAMS in crates/core/src/bus.rs. */
export const BUS_PARAMS = meta([['FLT', 0.5], ['DRV', 0], ['LEVEL', 0.8]])
/** Mirrors MASTER_PARAMS in crates/core/src/master.rs. */
export const MASTER_PARAMS = meta([
  ['COMP', 0.2], ['ATK', 0.6], ['REL', 0.5], ['MIX', 1], ['SAT', 0.1], ['CURVE', 0.5], ['TILT', 0.5], ['LOW CUT', 0],
  ['CEIL', 0.975], ['MODE', 0], ['LEVEL', 0.8],
])

const KICK: MachineDef = { name: 'ANALOG BD', melodic: false, params: KICK_PARAMS, pages: KICK_PAGES }
const SUB: MachineDef = { name: 'SUB', melodic: true, params: SUB_PARAMS, pages: [{ name: 'SRC', params: [0, 1, 2, 3, 4, 5, 6, 7] }] }
const MID: MachineDef = {
  name: 'MID BASS', melodic: true, params: MID_PARAMS,
  pages: [{ name: 'SRC', params: [0, 1, 2, 3, 4, 5, 6, 7] }, { name: 'FLTR', params: [8, 9, 10, 11, 12, 13, 14, 15] }, { name: 'AMP', params: [16] }],
}

export const TRACK_COUNT = 13
export const BUS_COUNT = 8
export const BUS_NAMES = ['KICK', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ORN', 'FX']
export const MASTER_ROW = TRACK_COUNT + BUS_COUNT
export const ROW_COUNT = MASTER_ROW + 1
export const BUS_FILTER = 0
export const BUS_DRIVE = 1
export const BUS_LEVEL = 2
export const MASTER_MODE = 9
export const MASTER_LEVEL = 10

export const MACHINES: (MachineDef | null)[] = Array.from({ length: TRACK_COUNT }, (_, t) =>
  t <= 1 ? KICK : t === 7 ? SUB : t === 8 ? MID : null)

export const busRow = (b: number) => TRACK_COUNT + b
export const isMelodic = (t: number) => MACHINES[t]?.melodic ?? false

export function rowParamMetas(row: number): ParamMeta[] {
  if (row < TRACK_COUNT) return MACHINES[row]?.params ?? []
  if (row < MASTER_ROW) return BUS_PARAMS
  return row === MASTER_ROW ? MASTER_PARAMS : []
}

export function rowLabel(trackNames: string[], row: number): string {
  if (row < TRACK_COUNT) return trackNames[row] ?? `T${row}`
  if (row < MASTER_ROW) return `${BUS_NAMES[row - TRACK_COUNT]} BUS`
  return 'MASTER'
}

export function paramLabel(trackNames: string[], row: number, p: number): string {
  return `${rowLabel(trackNames, row)}.${rowParamMetas(row)[p]?.name ?? p}`
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`

/** Same law as bus::fader_gain: 0.8 = 0 dB, 1 ≈ +6 dB. */
export function faderDb(norm: number): string {
  if (norm <= 0) return '−∞'
  const db = 20 * Math.log10((norm / 0.8) ** 3.1)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}
