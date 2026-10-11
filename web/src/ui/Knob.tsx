import { useRef } from 'react'
import { MOD_DRAG_TYPE } from '@/state/modulation'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const SIZE = 56
const MID = SIZE / 2
const R = 18
const C = 2 * Math.PI * R
const RM = 24
const CM = 2 * Math.PI * RM
/** Drags beyond this radius (in knob units) edit the modulation amount. */
const MOD_RING_RADIUS = 21
const angleOf = (v: number) => 135 + v * 270
const pointAt = (v: number, r: number) => {
  const a = (angleOf(v) * Math.PI) / 180
  return { x: MID + r * Math.cos(a), y: MID + r * Math.sin(a) }
}

export interface KnobProps {
  label: string
  /** The value being edited: the base, or the macro endpoint while LEARN is armed. */
  value: number
  /** Live value after macros and modulation; defaults to `value`. */
  display?: number
  defaultValue: number
  /** Sum of route amounts on this parameter, −1..1. */
  modAmount?: number
  markers?: { a: number; b: number } | null
  learning?: boolean
  selected?: boolean
  onChange(value: number): void
  onModAmount?(delta: number): void
  onDropModulator?(slot: number): void
  onSelect?(): void
  /** 'sm' renders 40 px (mixer), default 56 px. */
  size?: 'md' | 'sm'
  /** Accessible name when the visible label is not unique (e.g. 'KICK filter'). */
  ariaLabel?: string
}

/** Vertical drag (⇧ = fine); outer ring drag = mod amount; double-click = default; drop a modulator to route it. */
export function Knob({
  label, value, display = value, defaultValue, modAmount = 0, markers = null, learning = false, selected = false,
  onChange, onModAmount, onDropModulator, onSelect, size = 'md', ariaLabel,
}: KnobProps) {
  const drag = useRef<{ y: number; mode: 'value' | 'mod' } | null>(null)
  const current = useRef(value)
  current.current = value

  const nudge = (delta: number) => {
    const next = clamp01(current.current + delta)
    current.current = next
    onChange(next)
  }

  const modLen = Math.min(1, Math.abs(modAmount)) * 0.75 * CM
  const modRotate = modAmount >= 0 ? angleOf(value) : angleOf(value) - Math.min(1, -modAmount) * 270
  const dot = pointAt(display, R)
  const pct = (v: number) => Math.round(v * 100)

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <svg
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct(value)}
        aria-valuetext={`${pct(display)}${modAmount ? `, modulated ${pct(modAmount)}` : ''}${learning ? ', LEARN' : ''}`}
        width={size === 'sm' ? 40 : SIZE}
        height={size === 'sm' ? 40 : SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-acc ${learning ? 'ring-1 ring-red-500' : ''}`}
        onPointerDown={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const scale = box.width / SIZE || 1
          const dist = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2)) / scale
          const mode = onModAmount && modAmount !== 0 && dist > MOD_RING_RADIUS ? 'mod' : 'value'
          e.currentTarget.setPointerCapture?.(e.pointerId)
          drag.current = { y: e.clientY, mode }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const delta = (drag.current.y - e.clientY) / (e.shiftKey ? 1000 : 200)
          drag.current.y = e.clientY
          if (drag.current.mode === 'mod') onModAmount?.(delta)
          else nudge(delta)
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.001 : 0.01
          const keys: Record<string, () => void> = {
            ArrowUp: () => nudge(step), ArrowRight: () => nudge(step),
            ArrowDown: () => nudge(-step), ArrowLeft: () => nudge(-step),
            Home: () => onChange(0), End: () => onChange(1),
          }
          const action = keys[e.key]
          if (action) {
            e.preventDefault()
            action()
          }
        }}
        onDragOver={(e) => {
          if (onDropModulator && Array.from(e.dataTransfer.types).includes(MOD_DRAG_TYPE)) e.preventDefault()
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(MOD_DRAG_TYPE)
          if (!onDropModulator || raw === '') return
          e.preventDefault()
          onDropModulator(Number(raw))
        }}
      >
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className="stroke-zinc-800"
          strokeDasharray={`${0.75 * C} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className="stroke-acc"
          strokeDasharray={`${0.75 * C * value} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        {modAmount !== 0 && (
          <circle cx={MID} cy={MID} r={RM} fill="none" strokeWidth={2} className="stroke-mod"
            strokeDasharray={`${modLen} ${CM}`} transform={`rotate(${modRotate} ${MID} ${MID})`} />
        )}
        {markers && (
          <>
            <circle cx={pointAt(markers.a, RM).x} cy={pointAt(markers.a, RM).y} r={2.5} className="fill-zinc-400" />
            <circle cx={pointAt(markers.b, RM).x} cy={pointAt(markers.b, RM).y} r={2.5} className="fill-mod" />
          </>
        )}
        <circle cx={dot.x} cy={dot.y} r={2} className="fill-zinc-100" />
      </svg>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={ariaLabel ?? label}
        className={`rounded text-[10px] uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-acc ${selected ? 'text-mod' : 'text-zinc-400'}`}>
        {label}
      </button>
      {learning && <span aria-hidden="true" className="-mt-0.5 rounded bg-red-600 px-1 text-[9px] leading-tight font-bold text-white">L</span>}
      <span className={size === 'sm' ? 'text-[10px] tabular-nums' : 'text-sm tabular-nums'}>{pct(display)}</span>
    </div>
  )
}
