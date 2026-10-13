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

/** One cycle for tile/editor previews, values −1..1; random shapes use a fixed pattern. */
export function previewShape(m: ModulatorState, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const p = i / (n - 1)
    if (m.kind === 2) return FIXED_RANDOM[i % FIXED_RANDOM.length]
    if (m.kind === 3) return m.steps[Math.min(m.stepLen - 1, Math.floor(p * m.stepLen))]
    if (m.kind === 4) return envAt(m.env, p) * 2 - 1
    switch (m.shape) {
      case 0: return Math.sin(p * 2 * Math.PI)
      case 2: return FIXED_RANDOM[Math.min(3, Math.floor(p * 4))]
      case 3: return 1 - 4 * Math.abs(p - 0.5)
      case 4: return 1 - 2 * p
      case 5: return 2 * p - 1
      case 6: return p < 0.5 ? 1 : -1
      case 7: return 2 * Math.exp(-5 * p) - 1
      default: {
        const seg = Math.min(3, Math.floor(p * 4))
        const t = p * 4 - seg
        const a = FIXED_RANDOM[seg]
        const b = FIXED_RANDOM[seg + 1]
        return a + (b - a) * (0.5 - 0.5 * Math.cos(t * Math.PI))
      }
    }
  })
}
