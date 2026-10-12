import { useRef, type PointerEvent } from 'react'

const W = 100
const H = 40
const SEG = 24
const K = 5
const fall = (p: number) => (Math.exp(-K * p) - Math.exp(-K)) / (1 - Math.exp(-K))

interface Props {
  /** ATK HOLD DEC SUS REL, normalised. */
  values: number[]
  onChange(index: number, value: number): void
}

/**
 * The AHDSR curve as it will sound (same normalised exponential as the engine). Drag the points:
 * attack/hold/release move sideways, the decay point moves sideways (DEC) and up/down (SUS).
 * Keyboard editing lives in the value slots next to it.
 */
export function EnvGraph({ values, onChange }: Props) {
  const [a, h, d, s, r] = values
  const xa = a * SEG
  const xh = xa + h * SEG
  const xd = xh + d * SEG
  const xr = xd + r * SEG
  const ys = 1 + (1 - s) * (H - 2)
  const decay = Array.from({ length: 13 }, (_, i) => {
    const p = i / 12
    return `L${(xh + p * (xd - xh)).toFixed(2)},${(1 + (1 - (s + (1 - s) * fall(p))) * (H - 2)).toFixed(2)}`
  }).join(' ')
  const release = Array.from({ length: 13 }, (_, i) => {
    const p = i / 12
    return `L${(xd + p * (xr - xd)).toFixed(2)},${(1 + (1 - s * fall(p)) * (H - 2)).toFixed(2)}`
  }).join(' ')
  const path = `M0,${H - 1} L${xa.toFixed(2)},1 L${xh.toFixed(2)},1 ${decay} ${release}`
  const handles = [[xa, 1], [xh, 1], [xd, ys], [xr, H - 1]]
  // `ties` = handles sitting on the same spot (e.g. ATK and HOLD when HOLD is 0): the first drag direction picks one
  const drag = useRef<{ handle: number; ties: number[]; x: number; y: number; start: number[]; sx: number; sy: number } | null>(null)

  const toView = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { sx: W / (box.width || W), sy: H / (box.height || H), x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"
      className="h-full min-h-10 w-full cursor-grab touch-none bg-zinc-900"
      onPointerDown={(e) => {
        const v = toView(e)
        const px = v.x * v.sx
        const py = v.y * v.sy
        const dist = handles.map(([hx, hy]) => Math.hypot(hx - px, (hy - py) / 2))
        const best = Math.min(...dist)
        const ties = dist.flatMap((d, i) => (d - best < 0.75 ? [i] : []))
        e.currentTarget.setPointerCapture?.(e.pointerId)
        drag.current = { handle: ties[0], ties, x: e.clientX, y: e.clientY, start: [...values], sx: v.sx, sy: v.sy }
      }}
      onPointerMove={(e) => {
        const g = drag.current
        if (!g) return
        const dx = ((e.clientX - g.x) * g.sx) / SEG
        const dy = ((e.clientY - g.y) * g.sy) / (H - 2)
        if (g.ties.length > 1 && dx !== 0) {
          // stacked points: dragging right grows the later stage, dragging left the earlier one
          g.handle = dx > 0 ? g.ties[g.ties.length - 1] : g.ties[0]
          g.ties = [g.handle]
        }
        // the dragged point's own segment: A (0), H (1), D (2, plus SUS vertically), R (4)
        const seg = [0, 1, 2, 4][g.handle]
        const next = clamp01(g.start[seg] + dx)
        if (next !== values[seg]) onChange(seg, next)
        if (g.handle === 2) {
          const sus = clamp01(g.start[3] - dy)
          if (sus !== values[3]) onChange(3, sus)
        }
      }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}>
      <path d={`${path} L${xr.toFixed(2)},${H}  L0,${H} Z`} className="fill-zinc-800" />
      <path d={path} fill="none" className="stroke-zinc-200" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {handles.map(([hx, hy], i) => (
        <circle key={i} cx={hx} cy={hy} r={1.6} className="fill-zinc-100" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
