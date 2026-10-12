/** How a normalised 0..1 value is shown under a knob. */
export type Display =
  | { kind: 'db' }
  | { kind: 'pct' }
  | { kind: 'range'; min: number; max: number; curve?: 'lin' | 'exp'; unit: string; digits?: number; signed?: boolean }
  | { kind: 'choice'; options: string[] }
  | { kind: 'djfilter' }
  | { kind: 'pan' }

export interface ParamMeta {
  name: string
  default: number
  display?: Display
}

const hz = (min: number, max: number): Display => ({ kind: 'range', min, max, curve: 'exp', unit: 'Hz' })
const ms = (min: number, max: number, curve: 'lin' | 'exp' = 'exp'): Display => ({ kind: 'range', min, max, curve, unit: 'ms' })

/** Mirrors KICK_PARAMS in crates/core/src/kick.rs: same order, same default_norm. */
export const KICK_PARAMS: ParamMeta[] = [
  { name: 'TUNE', default: 0.270567, display: { kind: 'range', min: 30, max: 120, curve: 'exp', unit: 'note' } },
  { name: 'SWEEP', default: 0.5, display: { kind: 'range', min: 0, max: 48, unit: 'st' } },
  { name: 'S.TIME', default: 0.508, display: ms(5, 300) },
  { name: 'DECAY', default: 0.5637, display: ms(50, 2000) },
  { name: 'CLICK', default: 0.3, display: { kind: 'pct' } },
  { name: 'NOISE', default: 0.05, display: { kind: 'pct' } },
  { name: 'TONE', default: 0.8, display: hz(200, 12000) },
  { name: 'LEVEL', default: 0.8, display: { kind: 'db' } },
]

/**
 * Shared knob template for every machine page (engine param indices stay put, only the order on screen):
 * top row 1–3 source · 4 DECAY (always top right), bottom row 5 transient · 6 tone · 7 dirt/noise · 8 LEVEL.
 */
export const KICK_PAGES = [{ name: 'KICK', params: [0, 1, 2, 3, 4, 6, 5, 7] }]

export { hz, ms }
