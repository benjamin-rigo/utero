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
  // 5: free — the amp decay moved to the envelope
  { name: '', default: 0 },
  { name: 'FM', default: 0, display: { kind: 'pct' } },
  { name: 'LEVEL', default: 0.8, display: db },
  { name: 'SUB OCT', default: 1, display: { kind: 'choice', options: ['−1', '0', '+1'] } },
]
/** Mirrors BUS_PARAMS in crates/core/src/bus.rs. */
export const BUS_PARAMS: ParamMeta[] = [
  { name: 'FLT', default: 0.5, display: { kind: 'djfilter' } },
  { name: 'DRV', default: 0, display: pct },
  { name: 'LEVEL', default: 0.8, display: db },
  { name: 'PAN', default: 0.5, display: { kind: 'pan' } },
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
  // global insert-FX settings shared by every machine's delay / reverb
  { name: 'DLY TIME', default: 0.4, display: { kind: 'choice', options: ['1/16', '1/8', '1/8D', '1/4', '1/4D', '1/2'] } },
  { name: 'DLY FB', default: 0.45, display: { kind: 'range', min: 0, max: 95, unit: '%' } },
  { name: 'DLY TONE', default: 0.5, display: hz(500, 12000) },
  { name: 'REV SIZE', default: 0.6, display: pct },
  { name: 'REV DECAY', default: 0.5, display: { kind: 'range', min: 0.3, max: 12, curve: 'exp', unit: 's', digits: 1 } },
  { name: 'REV DAMP', default: 0.5, display: pct },
  { name: 'REV PRE', default: 0.1, display: ms(0, 100, 'lin') },
]
export const MASTER_DELAY = [11, 12, 13]
export const MASTER_REVERB = [14, 15, 16, 17]

/** Insert FX ids = order of their amount params at FX_BASE + id (mirrors crates/core/src/fx.rs). */
export const FX_NAMES = ['drive', 'fold', 'filter', 'noise', 'chorus', 'disperse', 'delay', 'reverb']
export const FX_FILTER = 2
export const FX_DELAY = 6
export const FX_REVERB = 7
export const FX_FILTER_MODE = 15
export const FX_BASE = 16
export const FILTER_MODES = ['lp', 'hp', 'comb']
export const DEFAULT_FX_ORDER = [0, 1, 2, 3, 4, 5, 6, 7]

/** Amp envelope at row 10..14 (mirrors crates/core/src/env.rs); also the ENV modulator's ranges. */
export const ENV_BASE = 10
export const ENV_NAMES = ['ATK', 'HOLD', 'DEC', 'SUS', 'REL']
export const ENV_DISPLAYS: Display[] = [ms(0.5, 4000), ms(0.5, 4000), ms(1, 8000), pct, ms(1, 8000)]
export const envMeta = (i: number, def: number): ParamMeta => ({ name: ENV_NAMES[i], default: def, display: ENV_DISPLAYS[i] })

/** A machine's row: its params, the amp envelope at 10..14, the FX controls at 15..23 (mirrors fx::with_fx). */
function withFx(machine: ParamMeta[], env: number[]): ParamMeta[] {
  const row: ParamMeta[] = Array.from({ length: 24 }, () => ({ name: '', default: 0 }))
  machine.forEach((m, i) => { row[i] = m })
  env.forEach((d, i) => { row[ENV_BASE + i] = envMeta(i, d) })
  row[FX_FILTER_MODE] = { name: 'FLT MODE', default: 0, display: { kind: 'choice', options: FILTER_MODES } }
  FX_NAMES.forEach((n, k) => { row[FX_BASE + k] = { name: n.toUpperCase(), default: 0, display: pct } })
  return row
}

const KICK: MachineDef = { name: 'ANALOG BD', melodic: false, params: withFx(KICK_PARAMS, [0, 0, 0.8137, 0, 0.4353]), pages: KICK_PAGES }
const BASS: MachineDef = {
  name: 'BASS', melodic: true, params: withFx(BASS_PARAMS, [0.1543, 0.3536, 0.6534, 0, 0.4556]),
  // SUB CHAR FM SUB OCT / PLUCK BRIGHT GRIT LEVEL (template in kickParams.ts)
  pages: [{ name: 'BASS', params: [0, 1, 6, 8, 3, 2, 4, 7] }],
}

export const TRACK_COUNT = 12
export const BUS_COUNT = 8
export const BUS_NAMES = ['KICK', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ORN', 'FX']
/** Starting bus faders in dB (techno gain plan), mirrors BUS_DEFAULT_DB in crates/core/src/bus.rs. */
export const BUS_DEFAULT_DB = [-6, -14, -12, -6, -12, -16, -16, -12]
/** Inverse of the fader law (0.8 = 0 dB). */
export const faderNormForDb = (db: number) => 0.8 * 10 ** (db / 62)
export const MASTER_ROW = TRACK_COUNT + BUS_COUNT
export const ROW_COUNT = MASTER_ROW + 1
export const BUS_FILTER = 0
export const BUS_DRIVE = 1
export const BUS_LEVEL = 2
export const BUS_PAN = 3
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
/** Nearest note plus cents offset, e.g. 'F1' or 'F#1 -47'. */
export function hzToNote(hz: number): string {
  const midi = 69 + 12 * Math.log2(hz / 440)
  const n = Math.round(midi)
  const cents = Math.round((midi - n) * 100)
  return cents === 0 ? noteName(n) : `${noteName(n)} ${cents > 0 ? '+' : ''}${cents}`
}

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
  if (d.kind === 'pan') {
    const side = Math.round((norm - 0.5) * 200)
    return side === 0 ? 'C' : `${side < 0 ? 'L' : 'R'}${Math.abs(side)}`
  }
  const v = rangeValue(d, norm)
  if (d.unit === 'Hz') return formatHz(v)
  if (d.unit === 'note') return hzToNote(v)
  if (d.unit === 'ms' && v >= 1000) return `${(v / 1000).toFixed(2)} s`
  const digits = d.digits ?? (Math.abs(v) < 10 && d.unit !== 'st' ? 1 : 0)
  return `${d.signed && v > 0 ? '+' : ''}${v.toFixed(digits)} ${d.unit}`
}

function formatHz(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`
}
