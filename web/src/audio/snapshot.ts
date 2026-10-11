export const SNAP_TRACKS = 13
export const SNAP_FLOATS = 1 + SNAP_TRACKS

export const playheadOf = (snap: Float32Array, track: number) => snap[1 + track]
