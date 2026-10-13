import { useRef, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { MOD_DRAG_TYPE } from '@/state/modulation'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const SIZE = 56
const MID = SIZE / 2
/** The 270° arc leaves the bottom of the circle empty: crop it (lowest point: a marker dot on the mod ring at 45°). */
const VIEW_H = 48
const R = 18
const C = 2 * Math.PI * R
const RM = 24
/** Inner ring for gain reduction. */
const RR = 12
const CR = 2 * Math.PI * RR
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
  /** 'sm' (the default everywhere) is the knob token size, 'xs' a bare dial (no label/value), 'slot' a full-width value bar. */
  size?: 'sm' | 'xs' | 'slot'
  /** Slot fill grows from the centre (filters, pan, tilt). */
  bipolar?: boolean
  /** Live gain reduction in dB (comp/limiter), drawn as an inner arc over 0–12 dB. */
  reduction?: number
  /** A press without drag (e.g. cycle the filter mode). */
  onTap?(): void
  /** Replaces double-click = default (e.g. open the delay/reverb settings). */
  onOpen?(): void
  /** Makes the label a drag handle (reordering the FX chain). */
  onLabelDragStart?(e: DragEvent<HTMLButtonElement>): void
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
  onChange, onModAmount, onDropModulator, onSelect, size = 'sm', ariaLabel, format, map = null, onMap, onMapClear, onHover, steps, tone = 'acc', bipolar = false, reduction, onTap, onOpen, onLabelDragStart,
}: KnobProps) {
  const drag = useRef<{ x: number; y: number; mode: 'value' | 'mod'; travel: number } | null>(null)
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
      : `${format ? format(display) : pct(display)}${modAmount ? `, modulated ${pct(modAmount)}` : ''}${reduction ? `, reducing ${reduction.toFixed(1)} dB` : ''}${learning ? ', LEARN' : ''}`,
    onPointerEnter: () => onHover?.(true),
    onPointerLeave: () => onHover?.(false),
    onPointerDown: (e: PointerEvent<Element>) => {
      const box = e.currentTarget.getBoundingClientRect()
      const scale = box.width / SIZE || 1
      const dist = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2)) / scale
      const mode = size !== 'slot' && !map && onModAmount && modAmount !== 0 && dist > MOD_RING_RADIUS ? 'mod' : 'value'
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drag.current = { x: e.clientX, y: e.clientY, mode, travel: 0 }
      current.current = value
    },
    onPointerMove: (e: PointerEvent<Element>) => {
      if (!drag.current) return
      // slots also follow horizontal drags (left/right reads naturally on a bar)
      const dy = drag.current.y - e.clientY
      const dx = size === 'slot' ? e.clientX - drag.current.x : 0
      const moved = Math.abs(dx) > Math.abs(dy) ? dx : dy
      drag.current.travel += Math.abs(dx) + Math.abs(dy)
      const delta = moved / (e.shiftKey ? 1000 : 200)
      drag.current.x = e.clientX
      drag.current.y = e.clientY
      if (drag.current.mode === 'mod') onModAmount?.(delta)
      else nudge(delta)
    },
    onPointerUp: () => {
      if (drag.current && drag.current.travel < 3) onTap?.()
      drag.current = null
    },
    onPointerCancel: () => { drag.current = null },
    onLostPointerCapture: () => { drag.current = null },
    onDoubleClick: () => (map ? onMapClear?.() : onOpen ? onOpen() : onChange(defaultValue)),
    onKeyDown: (e: KeyboardEvent<Element>) => {
      const step = steps && !map ? 1 / (steps - 1) : e.shiftKey ? 0.001 : 0.01
      const keys: Record<string, () => void> = {
        ArrowUp: () => nudge(step), ArrowRight: () => nudge(step),
        ArrowDown: () => nudge(-step), ArrowLeft: () => nudge(-step),
        Home: () => { if (!map) onChange(0) }, End: () => { if (!map) onChange(1) },
      }
      if (onTap && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        onTap()
        return
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
        className={`relative h-control w-full cursor-ns-resize touch-none overflow-hidden bg-well text-label select-none focus-ring ${learning ? 'ring-1 ring-alert' : ''}`}>
        <div className="absolute inset-y-0 bg-strong" style={span(bipolar ? 0.5 : 0, display)} />
        <div className="absolute inset-y-0 w-hair bg-ink-soft" style={{ left: `${value * 100}%` }} />
        {ring !== 0 && <div className="absolute bottom-0 h-0.5 bg-mod" style={span(value, clamp01(value + ring))} />}
        {map && <div className="absolute inset-0 border border-dashed border-mod/50" />}
        {markers && (
          <>
            <div className="absolute top-0 h-tight w-hair bg-faint" style={{ left: `${markers.a * 100}%` }} />
            <div className="absolute top-0 h-1.5 w-0.5 bg-ink" style={{ left: `${markers.b * 100}%` }} />
          </>
        )}
        <div className="relative flex h-full items-center justify-between gap-tight px-tight">
          <span className="truncate text-ink-soft">{label}</span>
          <span className={`tabular-nums ${map ? 'text-mod' : 'text-ink-soft'}`}>{shown}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-tight select-none">
      <svg
        {...slider}
        viewBox={`0 0 ${SIZE} ${VIEW_H}`} overflow="visible"
        className={`${size === 'xs' ? 'h-dial-h w-dial' : 'h-knob-h w-knob'} cursor-ns-resize touch-none focus-ring ${learning ? 'ring-1 ring-alert' : ''}`}
      >
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className="stroke-raised"
          strokeDasharray={`${0.75 * C} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className={tone === 'mono' ? 'stroke-ink-soft' : 'stroke-acc'}
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
            <circle cx={pointAt(markers.a, RM).x} cy={pointAt(markers.a, RM).y} r={2} className="fill-faint" />
            <circle cx={pointAt(markers.b, RM).x} cy={pointAt(markers.b, RM).y} r={3} className="fill-ink" />
          </>
        )}
        {reduction !== undefined && reduction > 0.05 && (
          <circle cx={MID} cy={MID} r={RR} fill="none" strokeWidth={3} className="stroke-ink"
            strokeDasharray={`${Math.min(1, reduction / 12) * 0.75 * CR} ${CR}`} transform={`rotate(135 ${MID} ${MID})`} />
        )}
        <circle cx={dot.x} cy={dot.y} r={2} className="fill-ink" />
      </svg>
{size !== 'xs' && (
        <>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={ariaLabel ?? label}
        draggable={onLabelDragStart !== undefined} onDragStart={onLabelDragStart}
        className={`text-label focus-ring ${selected ? 'font-bold text-ink' : 'text-ink-mute'}`}>
        {label}
      </button>
      {learning && <span aria-hidden="true" className="bg-alert px-tight text-micro font-bold text-ink">L</span>}
      <span className={`tabular-nums ${map ? 'text-mod' : 'text-ink-soft'}`}>
        {shown}
      </span>
        </>
      )}
    </div>
  )
}
