/** Layout mirrors SNAP_* in crates/core/src/engine.rs. */
export const SNAP_TRACKS = 12
export const SNAP_BUSES = 8
export const SNAP_ROWS = SNAP_TRACKS + SNAP_BUSES + 1
export const SNAP_MOD_SLOTS = 16
export const SNAP_PARAMS = 32
export const SNAP_PLAYHEADS = 1
export const SNAP_MODS = SNAP_PLAYHEADS + SNAP_TRACKS
export const SNAP_EFFECTIVE = SNAP_MODS + SNAP_MOD_SLOTS
export const SNAP_METERS = SNAP_EFFECTIVE + SNAP_ROWS * SNAP_PARAMS
export const SNAP_MUTED = SNAP_METERS + SNAP_BUSES * 2 + 5
export const SNAP_KICK_TRACKS = 2
export const SNAP_TUNER = SNAP_MUTED + SNAP_BUSES
export const SNAP_FLOATS = SNAP_TUNER + SNAP_KICK_TRACKS

export const playheadOf = (snap: Float32Array, track: number) => snap[SNAP_PLAYHEADS + track]
export const modOutputOf = (snap: Float32Array, slot: number) => snap[SNAP_MODS + slot]
export const effectiveOf = (snap: Float32Array, row: number, param: number) => snap[SNAP_EFFECTIVE + row * SNAP_PARAMS + param]
export const busMeterOf = (snap: Float32Array, bus: number) => ({ peak: snap[SNAP_METERS + 2 * bus], rms: snap[SNAP_METERS + 2 * bus + 1] })
export const masterMeterOf = (snap: Float32Array) => {
  const m = SNAP_METERS + SNAP_BUSES * 2
  return { peakL: snap[m], peakR: snap[m + 1], lufs: snap[m + 2], gr: snap[m + 3], limGr: snap[m + 4] }
}
/** Settled kick body frequency in Hz, 0 before the first hit. */
export const kickPitchOf = (snap: Float32Array, kick: number) => snap[SNAP_TUNER + kick]
export const busMutedOf = (snap: Float32Array, bus: number) => snap[SNAP_MUTED + bus] >= 0.5
