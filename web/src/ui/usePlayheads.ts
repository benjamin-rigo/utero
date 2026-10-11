import { useEffect, useState } from 'react'
import { playheadOf, SNAP_TRACKS } from '@/audio/snapshot'

const idle = () => Array<number>(SNAP_TRACKS).fill(-1)

export function usePlayheads(snapshot: Float32Array | null, playing: boolean): number[] {
  const [heads, setHeads] = useState<number[]>(idle)
  useEffect(() => {
    if (!snapshot || !playing) {
      setHeads(idle())
      return
    }
    let raf = 0
    let prev = ''
    const loop = () => {
      const next = Array.from({ length: SNAP_TRACKS }, (_, t) => playheadOf(snapshot, t))
      const key = next.join(',')
      if (key !== prev) {
        prev = key
        setHeads(next)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [snapshot, playing])
  return heads
}
