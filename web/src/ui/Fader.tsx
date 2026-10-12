import { useRef, type KeyboardEvent } from 'react'
import { faderNormForDb } from '@/state/machines'

interface Props {
  label: string
  pos: number
  defaultPos: number
  valueText?: string
  /** Peak 0..1 drawn as a thin bar at the right edge (mixer). */
  meter?: number
  empty?: boolean
  tone?: 'mix' | 'mod'
  /** Top = 0 (macros: A above, B below). */
  invert?: boolean
  onPos(pos: number): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Meter on the fader's own dB scale (like Ableton): a 0 dBFS peak sits at the 0 dB fader position. */
export const meterHeight = (peak: number) => (peak > 0 ? Math.min(100, faderNormForDb(20 * Math.log10(peak)) * 100) : 0)

/** Fill fader: relative drag (⇧ = fine), double-click = default, arrows ±0.01 (⇧ ±0.1), Home/End. */
export function Fader({ label, pos: value, defaultPos, valueText, meter, empty = false, tone = 'mix', invert = false, onPos: setValue }: Props) {
  // work in screen space (0 = bottom); invert maps it back to the value
  const pos = invert ? 1 - value : value
  const onPos = (p: number) => setValue(invert ? 1 - p : p)
  const drag = useRef<{ y: number; pos: number; h: number } | null>(null)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const keys: Record<string, number> = {
      ArrowUp: pos + step, ArrowRight: pos + step, ArrowDown: pos - step, ArrowLeft: pos - step,
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setValue(e.key === 'Home' ? 0 : 1)
    } else if (e.key in keys) {
      e.preventDefault()
      onPos(clamp01(keys[e.key]))
    }
  }
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)} aria-valuetext={valueText}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        drag.current = { y: e.clientY, pos, h: e.currentTarget.getBoundingClientRect().height || 100 }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const scale = e.shiftKey ? 4 : 1
        onPos(clamp01(d.pos + (d.y - e.clientY) / (d.h * scale)))
      }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
      onDoubleClick={() => setValue(defaultPos)}
      onKeyDown={onKey}
      className="relative h-full min-h-8 w-full cursor-ns-resize touch-none overflow-hidden bg-zinc-900 outline-none focus-visible:ring-1 focus-visible:ring-acc">
      <div className={`absolute inset-x-0 bottom-0 ${empty ? 'bg-zinc-800' : tone === 'mod' ? 'bg-mod/35' : 'bg-zinc-700'}`}
        style={{ height: `${pos * 100}%` }} />
      <div className={`absolute inset-x-0 h-px ${empty ? 'bg-zinc-600' : tone === 'mod' ? 'bg-mod' : 'bg-zinc-200'}`}
        style={{ bottom: `${pos * 100}%` }} />
      {meter !== undefined && (
        <div className="absolute right-0 bottom-0 w-[3px] bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500"
          style={{ height: `${meterHeight(meter)}%` }} />
      )}
      {valueText && <span className="absolute inset-x-0 top-1 text-center text-[10px] tabular-nums text-zinc-300">{valueText}</span>}
    </div>
  )
}
