import { useRef, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
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
  /** 'sm' renders 40 px, 'xs' a bare 24 px dial (no label/value), 'slot' a full-width value bar (mixer/master/mod), default 56 px. */
  size?: 'md' | 'sm' | 'xs' | 'slot'
  /** Slot fill grows from the centre (filters, pan, tilt). */
  bipolar?: boolean
  /** Accessible name when the visible label is not unique (e.g. 'KICK filter'). */
  ariaLabel?: string
  /** Shows the value in real units (dB, Hz, ms…); defaults to 0–100. */
  format?(value: number): string
  /** Map mode: the selected modulator's amount on this knob (−1..1); drags and arrows edit it, double-click clears. */
  map?: { label: string; amount: number } | null
  onMap?(delta: number): void
  onMapClear?(): void
  onHover?(on: boolean): void
  /** 'mono' draws the value arc in neutral grey instead of the accent. */
  tone?: 'acc' | 'mono'
  /** Discrete knob with this many positions: arrows move one position, drags accumulate across them. */
  steps?: number
}

/** Vertical drag (⇧ = fine); outer ring drag = mod amount; double-click = default; drop a modulator to route it. */
export function Knob({
  label, value, display = value, defaultValue, modAmount = 0, markers = null, learning = false, selected = false,
  onChange, onModAmount, onDropModulator, onSelect, size = 'md', ariaLabel, format, map = null, onMap, onMapClear, onHover, steps, tone = 'acc', bipolar = false,
}: KnobProps) {
  const drag = useRef<{ x: number; y: number; mode: 'value' | 'mod' } | null>(null)
  const current = useRef(value)
  // while dragging keep the unquantised position, so discrete knobs can travel between positions
  if (!drag.current) current.current = value

  const nudge = (delta: number) => {
    if (map) {
      onMap?.(delta)
      return
    }
    const next = clamp01(current.current + delta)
    current.current = next
    onChange(next)
  }

  const ring = map ? map.amount : modAmount
  const modLen = Math.min(1, Math.abs(ring)) * 0.75 * CM
  const modRotate = ring >= 0 ? angleOf(value) : angleOf(value) - Math.min(1, -ring) * 270
  const signed = (v: number) => `${v > 0 ? '+' : ''}${pct(v)}`
  const dot = pointAt(display, R)
  const pct = (v: number) => Math.round(v * 100)

  const slider = {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': ariaLabel ?? label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': pct(value),
    'aria-valuetext': map
      ? `${map.label} amount ${signed(map.amount)}`
      : `${format ? format(display) : pct(display)}${modAmount ? `, modulated ${pct(modAmount)}` : ''}${learning ? ', LEARN' : ''}`,
    onPointerEnter: () => onHover?.(true),
    onPointerLeave: () => onHover?.(false),
    onPointerDown: (e: PointerEvent<Element>) => {
      const box = e.currentTarget.getBoundingClientRect()
      const scale = box.width / SIZE || 1
      const dist = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2)) / scale
      const mode = size !== 'slot' && !map && onModAmount && modAmount !== 0 && dist > MOD_RING_RADIUS ? 'mod' : 'value'
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drag.current = { x: e.clientX, y: e.clientY, mode }
      current.current = value
    },
    onPointerMove: (e: PointerEvent<Element>) => {
      if (!drag.current) return
      // slots also follow horizontal drags (left/right reads naturally on a bar)
      const moved = (drag.current.y - e.clientY) + (size === 'slot' ? e.clientX - drag.current.x : 0)
      const delta = moved / (e.shiftKey ? 1000 : 200)
      drag.current.x = e.clientX
      drag.current.y = e.clientY
      if (drag.current.mode === 'mod') onModAmount?.(delta)
      else nudge(delta)
    },
    onPointerUp: () => { drag.current = null },
    onPointerCancel: () => { drag.current = null },
    onLostPointerCapture: () => { drag.current = null },
    onDoubleClick: () => (map ? onMapClear?.() : onChange(defaultValue)),
    onKeyDown: (e: KeyboardEvent<Element>) => {
      const step = steps && !map ? 1 / (steps - 1) : e.shiftKey ? 0.001 : 0.01
      const keys: Record<string, () => void> = {
        ArrowUp: () => nudge(step), ArrowRight: () => nudge(step),
        ArrowDown: () => nudge(-step), ArrowLeft: () => nudge(-step),
        Home: () => { if (!map) onChange(0) }, End: () => { if (!map) onChange(1) },
      }
      const action = keys[e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    },
    onDragOver: (e: DragEvent<Element>) => {
      if (onDropModulator && Array.from(e.dataTransfer.types).includes(MOD_DRAG_TYPE)) e.preventDefault()
    },
    onDrop: (e: DragEvent<Element>) => {
      const raw = e.dataTransfer.getData(MOD_DRAG_TYPE)
      if (!onDropModulator || raw === '') return
      e.preventDefault()
      onDropModulator(Number(raw))
    },
  }
  const shown = map ? signed(map.amount) : format ? format(display) : pct(display)

  if (size === 'slot') {
    const span = (from: number, to: number) => ({ left: `${Math.min(from, to) * 100}%`, width: `${Math.abs(to - from) * 100}%` })
    return (
      <div {...slider}
        className={`relative h-5 w-full cursor-ns-resize touch-none overflow-hidden bg-zinc-900 text-[10px] outline-none select-none focus-visible:ring-1 focus-visible:ring-zinc-100 ${learning ? 'ring-1 ring-red-500' : ''}`}>
        <div className="absolute inset-y-0 bg-zinc-700" style={span(bipolar ? 0.5 : 0, display)} />
        <div className="absolute inset-y-0 w-px bg-zinc-300" style={{ left: `${value * 100}%` }} />
        {ring !== 0 && <div className="absolute bottom-0 h-0.5 bg-mod" style={span(value, clamp01(value + ring))} />}
        {map && <div className="absolute inset-0 border border-dashed border-mod/50" />}
        {markers && (
          <>
            <div className="absolute top-0 h-1 w-px bg-zinc-400" style={{ left: `${markers.a * 100}%` }} />
            <div className="absolute top-0 h-1 w-px bg-mod" style={{ left: `${markers.b * 100}%` }} />
          </>
        )}
        <div className="relative flex h-full items-center justify-between gap-1 px-1 leading-none">
          <span className="truncate lowercase text-zinc-400">{label}</span>
          <span className={`tabular-nums ${map ? 'text-mod' : 'text-zinc-200'}`}>{shown}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <svg
        {...slider}
        width={size === 'xs' ? 24 : size === 'sm' ? 40 : SIZE}
        height={size === 'xs' ? 24 : size === 'sm' ? 40 : SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-acc ${learning ? 'ring-1 ring-red-500' : ''}`}
      >
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className="stroke-zinc-800"
          strokeDasharray={`${0.75 * C} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className={tone === 'mono' ? 'stroke-zinc-300' : 'stroke-acc'}
          strokeDasharray={`${0.75 * C * value} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        {map && (
          <circle cx={MID} cy={MID} r={RM} fill="none" strokeWidth={1} className="stroke-mod/40"
            strokeDasharray="2 3" />
        )}
        {ring !== 0 && (
          <circle cx={MID} cy={MID} r={RM} fill="none" strokeWidth={map ? 3 : 2} className="stroke-mod"
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
{size !== 'xs' && (
        <>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={ariaLabel ?? label}
        className={`rounded text-[10px] uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-acc ${selected ? 'text-mod' : 'text-zinc-400'}`}>
        {label}
      </button>
      {learning && <span aria-hidden="true" className="-mt-0.5 rounded bg-red-600 px-1 text-[9px] leading-tight font-bold text-white">L</span>}
      <span className={`${size === 'sm' ? 'text-[10px]' : 'text-sm'} tabular-nums ${map ? 'text-mod' : ''}`}>
        {shown}
      </span>
        </>
      )}
    </div>
  )
}
