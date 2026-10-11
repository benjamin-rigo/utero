export interface ParamMeta {
  name: string
  default: number
}

/** Mirrors KICK_PARAMS in crates/core/src/kick.rs: same order, same default_norm. */
export const KICK_PARAMS: ParamMeta[] = [
  { name: 'TUNE', default: 0.2925 },
  { name: 'SWEEP', default: 0.5 },
  { name: 'S.TIME', default: 0.508 },
  { name: 'DECAY', default: 0.5637 },
  { name: 'CLICK', default: 0.3 },
  { name: 'DRIVE', default: 0.2 },
  { name: 'NOISE', default: 0.05 },
  { name: 'TONE', default: 0.8 },
  { name: 'LEVEL', default: 0.8 },
]

export const KICK_PAGES = [
  { name: 'SRC', params: [0, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'AMP', params: [8] },
]
