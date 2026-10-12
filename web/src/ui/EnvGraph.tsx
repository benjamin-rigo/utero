import { useRef, type PointerEvent } from 'react'

const W = 100
const H = 40
/** Plot area inside the frame, so the curve never starts on the wall. */
const X0 = 4
const SPAN = W - 2 * X0
const SEG = SPAN / 3
const TOP = 4
const BOTTOM = H - 4
const K = 5
const fall = (p: number) => (Math.exp(-K * p) - Math.exp(-K)) / (1 - Math.exp(-K))

interface Props {
  /** ATK HOLD DEC (normalised); SUS/REL are not part of the shape (AHD). */
  values: number[]
  onChange(index: number, value: number): void
}

/**
 * The AHD curve as it will sound (same normalised exponential as the engine): each stage gets a third of
 * the width. Drag a point sideways to set its stage; stacked points follow the first drag direction.
 * Keyboard editing lives in the value slots next to it.
 */
export function EnvGraph({ values, onChange }: Props) {
  const [a, h, d] = values
  const xa = X0 + a * SEG
  const xh = xa + h * SEG
  const xd = xh + d * SEG
  const decay = Array.from({ length: 17 }, (_, i) => {
    const p = i / 16
    return `L${(xh + p * (xd - xh)).toFixed(2)},${(TOP + (1 - fall(p)) * (BOTTOM - TOP)).toFixed(2)}`
  }).join(' ')
  const path = `M${X0},${BOTTOM} L${xa.toFixed(2)},${TOP} L${xh.toFixed(2)},${TOP} ${decay}`
  const handles = [xa, xh, xd]
  const handleY = [TOP, TOP, BOTTOM]
  // `ties` = points on the same spot (e.g. ATK and HOLD when HOLD is 0): the first drag direction picks one
  const drag = useRef<{ handle: number; ties: number[]; x: number; start: number[]; sx: number } | null>(null)
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const sx = W / (box.width || W)
    const px = (e.clientX - box.left) * sx
    const dist = handles.map((hx) => Math.abs(hx - px))
    const best = Math.min(...dist)
    const ties = dist.flatMap((v, i) => (v - best < 1 ? [i] : []))
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { handle: ties[0], ties, x: e.clientX, start: [...values], sx }
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current
    if (!g) return
    const dx = ((e.clientX - g.x) * g.sx) / SEG
    if (g.ties.length > 1 && dx !== 0) {
      // stacked points: dragging right grows the later stage, dragging left the earlier one
      g.handle = dx > 0 ? g.ties[g.ties.length - 1] : g.ties[0]
      g.ties = [g.handle]
    }
    const next = clamp01(g.start[g.handle] + dx)
    if (next !== values[g.handle]) onChange(g.handle, next)
  }

  return (
    <div aria-hidden="true" className="relative h-full min-h-12 w-full cursor-ew-resize touch-none bg-zinc-900"
      onPointerDown={onDown} onPointerMove={onMove}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {[1, 2].map((k) => (
          <line key={k} x1={X0 + k * SEG} x2={X0 + k * SEG} y1={TOP} y2={BOTTOM} className="stroke-zinc-800" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${path} L${xd.toFixed(2)},${BOTTOM} Z`} className="fill-zinc-800" />
        <path d={path} fill="none" className="stroke-zinc-200" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {handles.map((hx, i) => (
        <span key={i} className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full border border-zinc-900 bg-zinc-100"
          style={{ left: `${hx}%`, top: `${(handleY[i] / H) * 100}%` }} />
      ))}
    </div>
  )
}
