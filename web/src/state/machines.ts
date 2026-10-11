import { hz, KICK_PAGES, KICK_PARAMS, ms, type Display, type ParamMeta } from './kickParams'

export interface Page {
  name: string
  params: number[]
}

export interface Switch {
  param: number
  label: string
}

export interface MachineDef {
  name: string
  melodic: boolean
  params: ParamMeta[]
  pages: Page[]
  switches?: Switch[]
}

const pct: Display = { kind: 'pct' }
const db: Display = { kind: 'db' }

/** Mirrors BASS_PARAMS in crates/core/src/bass.rs. */
export const BASS_PARAMS: ParamMeta[] = [
  { name: 'SUB', default: 0.8, display: db },
  { name: 'CHAR', default: 0.51, display: pct },
  { name: 'BRIGHT', default: 0.2, display: hz(40, 12000) },
  { name: 'PLUCK', default: 0.14, display: pct },
  { name: 'GRIT', default: 0.2, display: pct },
  { name: 'DECAY', default: 0.176, display: ms(30, 4000) },
  { name: 'FM', default: 0, display: { kind: 'pct' } },
  { name: 'LEVEL', default: 0.8, display: db },
  { name: 'SUB OCT', default: 1, display: { kind: 'choice', options: ['−1', '0', '+1'] } },
]
/** Mirrors BUS_PARAMS in crates/core/src/bus.rs. */
export const BUS_PARAMS: ParamMeta[] = [
  { name: 'FLT', default: 0.5, display: { kind: 'djfilter' } },
  { name: 'DRV', default: 0, display: pct },
  { name: 'LEVEL', default: 0.8, display: db },
]
/** Mirrors MASTER_PARAMS in crates/core/src/master.rs. */
export const MASTER_PARAMS: ParamMeta[] = [
  { name: 'COMP', default: 0.2, display: pct },
  { name: 'ATK', default: 0.6, display: ms(0.1, 30) },
  { name: 'REL', default: 0.5, display: ms(30, 1000) },
  { name: 'MIX', default: 1, display: pct },
  { name: 'SAT', default: 0.1, display: pct },
  { name: 'CURVE', default: 0.5, display: pct },
  { name: 'TILT', default: 0.5, display: { kind: 'range', min: -6, max: 6, unit: 'dB', digits: 1, signed: true } },
  { name: 'LOW CUT', default: 0, display: hz(10, 150) },
  { name: 'CEIL', default: 0.975, display: { kind: 'range', min: -12, max: 0, unit: 'dB', digits: 1 } },
  { name: 'MODE', default: 0, display: { kind: 'choice', options: ['LIMIT', 'CLIP'] } },
  { name: 'LEVEL', default: 0.6402, display: db },
]

const KICK: MachineDef = { name: 'ANALOG BD', melodic: false, params: KICK_PARAMS, pages: KICK_PAGES }
const BASS: MachineDef = {
  name: 'BASS', melodic: true, params: BASS_PARAMS,
  // SUB CHAR FM · PLUCK · BRIGHT · GRIT · DECAY · LEVEL (template in kickParams.ts)
  pages: [{ name: 'BASS', params: [0, 1, 6, 3, 2, 4, 5, 7] }],
  switches: [{ param: 8, label: 'SUB OCT' }],
}

export const TRACK_COUNT = 12
export const BUS_COUNT = 8
export const BUS_NAMES = ['KICK', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ORN', 'FX']
/** Starting bus faders in dB (techno gain plan), mirrors BUS_DEFAULT_DB in crates/core/src/bus.rs. */
export const BUS_DEFAULT_DB = [-6, -14, -12, -3, -12, -16, -16, -12]
/** Inverse of the fader law (0.8 = 0 dB). */
export const faderNormForDb = (db: number) => 0.8 * 10 ** (db / 62)
export const MASTER_ROW = TRACK_COUNT + BUS_COUNT
export const ROW_COUNT = MASTER_ROW + 1
export const BUS_FILTER = 0
export const BUS_DRIVE = 1
export const BUS_LEVEL = 2
export const MASTER_MODE = 9
export const MASTER_LEVEL = 10

export const MACHINES: (MachineDef | null)[] = Array.from({ length: TRACK_COUNT }, (_, t) =>
  t <= 1 ? KICK : t === 7 ? BASS : null)

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

function rangeValue(d: Extract<Display, { kind: 'range' }>, norm: number): number {
  return d.curve === 'exp' ? d.min * (d.max / d.min) ** norm : d.min + (d.max - d.min) * norm
}

/** Human-readable value of a normalised param: dB, Hz/kHz, ms/s, %, semitones or a mode name. */
export function formatParam(meta: ParamMeta, norm: number): string {
  const d = meta.display
  if (!d || d.kind === 'pct') return `${Math.round(norm * 100)}%`
  if (d.kind === 'db') return faderDb(norm)
  if (d.kind === 'choice') return d.options[Math.min(d.options.length - 1, Math.max(0, Math.round(norm * (d.options.length - 1))))]
  if (d.kind === 'djfilter') {
    if (norm < 0.48) return `LP ${formatHz(20 * 1000 ** (norm / 0.48))}`
    if (norm > 0.52) return `HP ${formatHz(20 * 1000 ** ((norm - 0.52) / 0.48))}`
    return 'OFF'
  }
  const v = rangeValue(d, norm)
  if (d.unit === 'Hz') return formatHz(v)
  if (d.unit === 'note') {
    const midi = 69 + 12 * Math.log2(v / 440)
    const n = Math.round(midi)
    const cents = Math.round((midi - n) * 100)
    return cents === 0 ? noteName(n) : `${noteName(n)} ${cents > 0 ? '+' : ''}${cents}`
  }
  if (d.unit === 'ms' && v >= 1000) return `${(v / 1000).toFixed(2)} s`
  const digits = d.digits ?? (Math.abs(v) < 10 && d.unit !== 'st' ? 1 : 0)
  return `${d.signed && v > 0 ? '+' : ''}${v.toFixed(digits)} ${d.unit}`
}

function formatHz(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`
}
