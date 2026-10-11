import { useRef, type KeyboardEvent } from 'react'
import { isMelodic, noteName } from '@/state/machines'
import { Knob } from './Knob'
import type { AppState } from '@/state/types'

export const SPEEDS = [
  { code: 0, label: '1/32' }, { code: 1, label: '1/16' }, { code: 2, label: '1/8' }, { code: 3, label: '1/4' },
  { code: 4, label: '1 BAR' }, { code: 5, label: '1/16T' }, { code: 6, label: '1/8T' },
]
/** Speed codes in musical order (fastest first) for the rate knob. */
const SPEED_ORDER = [0, 5, 1, 6, 2, 3, 4]
const speedIndex = (code: number) => Math.max(0, SPEED_ORDER.indexOf(code))
const speedLabel = (code: number) => SPEEDS.find((sp) => sp.code === code)?.label ?? ''
const VISIBLE = 16
const MAX_LENGTH = 64
const PX_PER_SEMITONE = 8

interface Props {
  state: AppState
  playheads: number[]
  onToggle(track: number, step: number): void
  onSetLength(track: number, length: number): void
  onSetSpeed(track: number, code: number): void
  onSelect(track: number): void
  onSetNote(track: number, step: number, note: number): void
}

/** Pixels before a press on a melodic step turns into a note drag instead of a click. */
const DRAG_START_PX = 4

/**
 * Click = trig (and selects the row), ⌥+click = track ends here. On melodic trigs ↑↓ / wheel / vertical drag = semitone,
 * ⇧ = octave. Keyboard: ←→ move along the row, ↑↓ between rows (off melodic trigs), Space/Enter writes a trig.
 */
export function SequencerMatrix({ state, playheads, onToggle, onSetLength, onSetSpeed, onSelect, onSetNote }: Props) {
  const drag = useRef<{ t: number; s: number; y: number; note: number; trig: boolean; moved: boolean } | null>(null)
  const dragged = useRef(false)
  // Trackpads send many small wheel events: step one semitone per ~50 px of scroll.
  const wheel = useRef(0)
  const root = useRef<HTMLElement>(null)
  const lengthDrag = useRef<number | null>(null)

  /** Index of the visible step whose column the pointer is over (clamped to the row). */
  const stepUnder = (t: number, x: number) => {
    const cells = root.current?.querySelectorAll<HTMLElement>(`[data-track="${t}"][data-step]`) ?? []
    let s = 0
    cells.forEach((c, i) => { if (x >= c.getBoundingClientRect().left) s = i })
    return s
  }

  const focusStep = (t: number, s: number) => {
    const tt = Math.min(state.tracks.length - 1, Math.max(0, t))
    const ss = Math.min(VISIBLE - 1, Math.max(0, s))
    root.current?.querySelector<HTMLButtonElement>(`[data-track="${tt}"][data-step="${ss}"]`)?.focus()
  }

  const onStepKey = (e: KeyboardEvent, t: number, s: number, note: number, noteEdit: boolean) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => focusStep(t, s - 1),
      ArrowRight: () => focusStep(t, s + 1),
      ArrowUp: () => (noteEdit ? onSetNote(t, s, note + (e.shiftKey ? 12 : 1)) : focusStep(t - 1, s)),
      ArrowDown: () => (noteEdit ? onSetNote(t, s, note - (e.shiftKey ? 12 : 1)) : focusStep(t + 1, s)),
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    move()
  }

  return (
    <section ref={root} aria-label="Sequencer" className="flex min-h-0 flex-1 flex-col gap-[3px] border-r border-zinc-800 p-2">
      <p className="pb-1 text-[10px] text-zinc-400">klikk = trig · ↑↓ / görgő / húzás a trigen = hang (⇧ oktáv) · ←→ léptet · ⌥+klikk = sávhossz</p>
      {state.tracks.map((tr, t) => {
        const newBus = t > 0 && state.tracks[t - 1].bus !== tr.bus
        const selected = state.selected === t
        const melodic = isMelodic(t)
        return (
          <div key={tr.name}
            className={`grid min-h-0 flex-1 grid-cols-[52px_repeat(16,1fr)_150px] items-stretch gap-[3px] rounded ${newBus ? 'mt-1.5' : ''} ${selected ? 'bg-zinc-900 ring-1 ring-acc/30' : ''}`}>
            <button type="button" onClick={() => onSelect(t)} aria-pressed={selected}
              className={`rounded px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-acc ${selected ? 'text-acc' : 'text-zinc-400'}`}>
              {tr.name}
            </button>
            {tr.steps.slice(0, VISIBLE).map((st, s) => {
              const beyond = s >= tr.length
              const isEnd = s === tr.length - 1
              const isHead = playheads[t] === s
              const noteEdit = melodic && st.trig
              return (
                <button key={s} type="button" aria-pressed={st.trig} data-track={t} data-step={s}
                  aria-label={melodic ? `${tr.name} step ${s + 1}, ${noteName(st.note)}` : `${tr.name} step ${s + 1}`}
                  onFocus={() => { if (!selected) onSelect(t) }}
                  onClick={(e) => {
                    if (dragged.current) {
                      dragged.current = false
                      return
                    }
                    if (!selected) onSelect(t)
                    if (e.altKey) onSetLength(t, s + 1)
                    else onToggle(t, s)
                  }}
                  onKeyDown={(e) => onStepKey(e, t, s, st.note, noteEdit)}
                  onWheel={(e) => {
                    if (!noteEdit) return
                    wheel.current += e.deltaY
                    if (Math.abs(wheel.current) < 50) return
                    onSetNote(t, s, st.note + (wheel.current < 0 ? 1 : -1))
                    wheel.current = 0
                  }}
                  onPointerDown={(e) => {
                    if (!melodic || e.altKey) return
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    drag.current = { t, s, y: e.clientY, note: st.note, trig: st.trig, moved: false }
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.t !== t || d.s !== s) return
                    const dy = d.y - e.clientY
                    if (!d.moved) {
                      if (Math.abs(dy) < DRAG_START_PX) return
                      d.moved = true
                      if (!d.trig) onToggle(t, s)
                    }
                    const semis = Math.round(dy / PX_PER_SEMITONE)
                    if (d.note + semis !== st.note) onSetNote(t, s, d.note + semis)
                  }}
                  onPointerUp={() => {
                    dragged.current = drag.current?.moved ?? false
                    drag.current = null
                  }}
                  onPointerCancel={() => { drag.current = null }}
                  className={[
                    'relative overflow-hidden rounded-sm text-[9px] leading-none text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                    st.trig ? 'bg-acc/70' : 'bg-zinc-900',
                    beyond ? 'opacity-30 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,#27272a_3px_6px)]' : '',
                    melodic ? 'touch-none' : '',
                    noteEdit ? 'cursor-ns-resize' : '',
                    s % 4 === 0 ? 'ml-0.5' : '',

                    isHead ? 'ring-1 ring-zinc-200' : '',
                  ].join(' ')}>
                  {noteEdit ? noteName(st.note) : null}
                  {isEnd && (
                    <span aria-hidden="true" data-length-handle
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none bg-acc hover:w-2"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        e.currentTarget.setPointerCapture?.(e.pointerId)
                        lengthDrag.current = t
                      }}
                      onPointerMove={(e) => {
                        if (lengthDrag.current !== t) return
                        const len = stepUnder(t, e.clientX) + 1
                        if (len !== tr.length) onSetLength(t, len)
                      }}
                      onPointerUp={() => {
                        lengthDrag.current = null
                        dragged.current = true
                      }}
                      onPointerCancel={() => { lengthDrag.current = null }} />
                  )}
                </button>
              )
            })}
            <div className="flex items-center justify-end gap-1 pl-2 text-[10px] text-zinc-400">
              <span role="slider" tabIndex={0} aria-label={`${tr.name} length`} aria-valuemin={1} aria-valuemax={MAX_LENGTH}
                aria-valuenow={tr.length} title="húzd a sáv végét, ⌥+klikk, vagy ←→"
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
                  if (!d) return
                  e.preventDefault()
                  onSetLength(t, Math.min(MAX_LENGTH, Math.max(1, tr.length + d)))
                }}
                className="w-8 rounded text-center tabular-nums text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-acc">
                {tr.length}
              </span>
              <Knob size="xs" label="RATE" ariaLabel={`${tr.name} rate`} steps={SPEED_ORDER.length}
                value={speedIndex(tr.speed) / (SPEED_ORDER.length - 1)} defaultValue={speedIndex(1) / (SPEED_ORDER.length - 1)}
                format={(v) => speedLabel(SPEED_ORDER[Math.round(v * (SPEED_ORDER.length - 1))])}
                onChange={(v) => {
                  const code = SPEED_ORDER[Math.round(v * (SPEED_ORDER.length - 1))]
                  if (code !== tr.speed) onSetSpeed(t, code)
                }} />
              <span className="w-10 tabular-nums text-zinc-300">{speedLabel(tr.speed)}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
