import { useRef } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const R = 18
const C = 2 * Math.PI * R

interface KnobProps {
  label: string
  value: number
  defaultValue: number
  onChange(value: number): void
}

/** Vertical drag (⇧ = fine), double-click = default, arrow keys = step. */
export function Knob({ label, value, defaultValue, onChange }: KnobProps) {
  const lastY = useRef<number | null>(null)
  const current = useRef(value)
  current.current = value

  const nudge = (delta: number) => {
    const next = clamp01(current.current + delta)
    current.current = next
    onChange(next)
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        width={48}
        height={48}
        viewBox="0 0 48 48"
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-acc"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          lastY.current = e.clientY
        }}
        onPointerMove={(e) => {
          if (lastY.current === null) return
          const dy = lastY.current - e.clientY
          lastY.current = e.clientY
          nudge(dy / (e.shiftKey ? 1000 : 200))
        }}
        onPointerUp={() => { lastY.current = null }}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.001 : 0.01
          if (e.key === 'ArrowUp') { e.preventDefault(); nudge(step) }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-step) }
        }}
      >
        <circle cx={24} cy={24} r={R} fill="none" strokeWidth={4} className="stroke-zinc-800"
          strokeDasharray={`${0.75 * C} ${C}`} transform="rotate(135 24 24)" />
        <circle cx={24} cy={24} r={R} fill="none" strokeWidth={4} className="stroke-acc"
          strokeDasharray={`${0.75 * C * value} ${C}`} transform="rotate(135 24 24)" />
      </svg>
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="text-sm tabular-nums">{Math.round(value * 100)}</span>
    </div>
  )
}
