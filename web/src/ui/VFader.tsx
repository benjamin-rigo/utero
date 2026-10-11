import type { KeyboardEvent, PointerEvent } from 'react'

interface Props {
  label: string
  pos: number
  empty?: boolean
  valueText?: string
  onPos(pos: number): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Vertical fader: click/drag = absolute position, arrows ±0.01 (⇧ ±0.1), Home/End. */
export function VFader({ label, pos, empty = false, valueText, onPos }: Props) {
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onPos(clamp01(1 - (e.clientY - r.top) / r.height))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const keys: Record<string, number> = {
      ArrowUp: pos + step, ArrowRight: pos + step, ArrowDown: pos - step, ArrowLeft: pos - step, Home: 0, End: 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      onPos(clamp01(keys[e.key]))
    }
  }
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(pos * 100)} aria-valuetext={valueText}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e) }}
      onPointerMove={(e) => { if (e.buttons) fromPointer(e) }}
      onKeyDown={onKey}
      className="relative flex h-full min-h-10 w-full cursor-ns-resize touch-none justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-acc">
      <div className={`h-full w-2 rounded ${empty ? 'bg-zinc-800' : 'bg-gradient-to-t from-zinc-700 to-sky-900'}`} />
      <div className="absolute left-1/2 h-3 w-7 -translate-x-1/2 rounded-sm bg-zinc-200 shadow" style={{ bottom: `calc(${pos * 100}% - 6px)` }} />
    </div>
  )
}
