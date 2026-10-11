/** Layout mirrors SNAP_* in crates/core/src/engine.rs. */
export const SNAP_TRACKS = 13
export const SNAP_MOD_SLOTS = 16
export const SNAP_PARAMS = 16
export const SNAP_PLAYHEADS = 1
export const SNAP_MODS = SNAP_PLAYHEADS + SNAP_TRACKS
export const SNAP_EFFECTIVE = SNAP_MODS + SNAP_MOD_SLOTS
export const SNAP_FLOATS = SNAP_EFFECTIVE + SNAP_TRACKS * SNAP_PARAMS

export const playheadOf = (snap: Float32Array, track: number) => snap[SNAP_PLAYHEADS + track]
export const modOutputOf = (snap: Float32Array, slot: number) => snap[SNAP_MODS + slot]
export const effectiveOf = (snap: Float32Array, track: number, param: number) => snap[SNAP_EFFECTIVE + track * SNAP_PARAMS + param]
