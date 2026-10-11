import { useEffect, useState } from 'react'

/** Copies the shared engine snapshot once per animation frame. */
export function useEngineFrame(snapshot: Float32Array | null): Float32Array | null {
  const [frame, setFrame] = useState<Float32Array | null>(null)
  useEffect(() => {
    if (!snapshot) {
      setFrame(null)
      return
    }
    let raf = 0
    const loop = () => {
      setFrame(snapshot.slice())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [snapshot])
  return frame
}
