import type { MacroState, ModulatorState } from './types'

export const MOD_SLOTS = 16
export const MAX_ROUTES = 64
export const STEP_COUNT = 16
export const MACROS = 8
export const MACRO_TARGETS = 16
export const MOD_DRAG_TYPE = 'application/x-utero-mod'

/** Index order mirrors SYNC_BARS in crates/core/src/modulation.rs. */
export const SYNC_LABELS = [
  '1/16T', '1/16', '1/8T', '1/16D', '1/8', '1/4T', '1/8D', '1/4', '1/2T', '1/4D',
  '1/2', '1T', '1/2D', '1 BAR', '1D', '2 BAR', '4 BAR', '8 BAR', '16 BAR', '32 BAR',
]
export const DEFAULT_RATE = SYNC_LABELS.indexOf('4 BAR')
/** Codes mirror Shape::from_code; the favourites (SIN, GLIDE, S&H) come first. */
export const SHAPES = [
  { code: 0, label: 'SIN' }, { code: 1, label: 'GLIDE' }, { code: 2, label: 'S&H' },
  { code: 3, label: 'TRI' }, { code: 4, label: 'SAW' }, { code: 5, label: 'RAMP' },
  { code: 6, label: 'SQR' }, { code: 7, label: 'EXP' }, { code: 8, label: 'DRIFT' },
]
export const FAVORITE_SHAPE_COUNT = 3
export const MOD_KINDS = ['OFF', 'LFO', 'NOISE', 'STEP', 'ENV']
/** Mirrors modulation::DEFAULT_ENV: 5 ms attack, no hold, 400 ms decay, 200 ms release. */
export const DEFAULT_ENV = [0.25, 0, 0.667, 0, 0.59]
export const NOISE_COLORS = ['WHITE', 'PINK', 'CRACKLE']
export const TRIG_MODES = ['FREE', 'RETRIG', 'ONESHOT']

export function defaultModulator(): ModulatorState {
  return {
    kind: 0, shape: 0, color: 0, sync: true, rateIndex: DEFAULT_RATE, hz: 1, phase: 0, bipolar: true,
    trigMode: 0, trigSrc: -1, smooth: 0, depth: 1, fade: 0, jitter: 0, steps: Array(STEP_COUNT).fill(0), stepLen: STEP_COUNT, env: [...DEFAULT_ENV],
  }
}

export function initialModulators(): ModulatorState[] {
  const mods = Array.from({ length: MOD_SLOTS }, defaultModulator)
  mods[0] = { ...mods[0], kind: 1, shape: 0, rateIndex: DEFAULT_RATE }
  mods[1] = { ...mods[1], kind: 1, shape: 1, rateIndex: SYNC_LABELS.indexOf('8 BAR') }
  mods[2] = { ...mods[2], kind: 1, shape: 2, rateIndex: SYNC_LABELS.indexOf('1/4') }
  mods[3] = { ...mods[3], kind: 2, color: 1 }
  return mods
}

export function initialMacros(): MacroState[] {
  return Array.from({ length: MACROS }, (_, i) => ({ name: `M${i + 1}`, pos: 0, targets: [] }))
}

export function modLabel(slot: number, m: ModulatorState): string {
  return m.kind === 0 ? '+ add' : `${MOD_KINDS[m.kind]}${slot + 1}`
}

export function rateLabel(m: ModulatorState): string {
  if (m.kind === 2) return NOISE_COLORS[m.color]
  return m.sync ? SYNC_LABELS[m.rateIndex] : `${m.hz.toFixed(2)} Hz`
}

const fall = (p: number) => (Math.exp(-5 * p) - Math.exp(-5)) / (1 - Math.exp(-5))
/** AHDSR level at position p of the graph (each stage up to a quarter of the width, like EnvGraph). */
function envAt([a, h, d, s, r]: number[], p: number): number {
  const x = p * 4
  if (x < a) return x / a
  if (x < a + h) return 1
  if (x < a + h + d) return s + (1 - s) * fall((x - a - h) / d)
  if (x < a + h + d + r) return s * fall((x - a - h - d) / r)
  return 0
}

const FIXED_RANDOM = [0.3, -0.7, 0.8, -0.2, 0.5, -0.9, 0.1, 0.6]
/** Bars per cycle for each sync division, mirrors SYNC_BARS (T = triplet). */
const T = 2 / 3
const SYNC_BARS = [0.0625 * T, 0.0625, 0.125 * T, 0.09375, 0.125, 0.25 * T, 0.1875, 0.25, 0.5 * T, 0.375, 0.5, T, 0.75, 1, 1.5, 2, 4, 8, 16, 32]
const SR = 48000
const FADE_MAX_CYCLES = 16
/** Deterministic −1..1 noise for previews (the same picture every render). */
const hash = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

/**
 * What the modulator will output over one bar (at least one cycle), on the shared −1..1 axis: rate sets how many cycles fit,
 * then fade, jitter, smooth, polarity (unipolar sits above the centre line) and depth are applied as the engine does.
 */
export function outputPreview(m: ModulatorState, bpm: number, n: number): number[] {
  const barSec = 240 / bpm
  const cycleBars = m.kind === 1 ? (m.sync ? SYNC_BARS[m.rateIndex] : 1 / (m.hz * barSec)) : 1
  const cycles = Math.min(16, Math.max(1, 1 / cycleBars))
  const windowSec = cycles * cycleBars * barSec
  const k = 1 / (1 + m.smooth * 2000)
  const a = 1 - (1 - k) ** ((windowSec * SR) / (n - 1))
  const fadeLen = FADE_MAX_CYCLES * m.fade * m.fade
  let smoothed = 0
  return Array.from({ length: n }, (_, i) => {
    const c = (i / (n - 1)) * (m.kind === 1 ? cycles : 1)
    let raw: number
    if (m.kind === 1) {
      const cycle = Math.min(Math.floor(c), Math.ceil(cycles) - 1)
      raw = shapeAt(m.shape, c - cycle, cycle)
      if (fadeLen > 0) {
        const x = Math.min(1, c / fadeLen)
        raw *= m.fade < 0 ? x : 1 - x
      }
      if (m.jitter > 0) raw = Math.max(-1, Math.min(1, raw + m.jitter * hash(i)))
    } else if (m.kind === 2) {
      raw = hash(Math.floor(i / 2) + 7)
    } else if (m.kind === 4) {
      raw = envAt(m.env, i / (n - 1)) * 2 - 1
    } else {
      raw = 0
    }
    smoothed = i === 0 ? raw : smoothed + (raw - smoothed) * a
    return (m.bipolar ? smoothed : (smoothed + 1) / 2) * m.depth
  })
}

/** One LFO cycle at phase p (0..1); random shapes take their values from the cycle number. */
function shapeAt(shape: number, p: number, cycle: number): number {
  const rnd = (j: number) => FIXED_RANDOM[(cycle * 4 + j) % FIXED_RANDOM.length]
  switch (shape) {
    case 0: return Math.sin(p * 2 * Math.PI)
    case 2: return rnd(0)
    case 3: return 1 - 4 * Math.abs(p - 0.5)
    case 4: return 1 - 2 * p
    case 5: return 2 * p - 1
    case 6: return p < 0.5 ? 1 : -1
    case 7: return 2 * Math.exp(-5 * p) - 1
    default: {
      const t = 0.5 - 0.5 * Math.cos(p * Math.PI)
      return rnd(0) + (rnd(1) - rnd(0)) * t
    }
  }
}

