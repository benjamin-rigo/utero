import { useRef, type KeyboardEvent } from 'react'
import { isMelodic, noteName } from '@/state/machines'
import { Knob } from './Knob'
import type { AppState } from '@/state/types'

/** Engine speed codes shown as Elektron-style multipliers of the 1/16 grid. */
export const SPEEDS = [
  { code: 0, label: '2×' }, { code: 1, label: '1×' }, { code: 2, label: '1/2×' }, { code: 3, label: '1/4×' },
  { code: 4, label: '1/16×' }, { code: 5, label: '3/2×' }, { code: 6, label: '3/4×' },
]
/** Slowest to fastest, so turning the rate knob right speeds the track up. */
const SPEED_ORDER = [4, 3, 2, 6, 1, 5, 0]
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
  /** Tuner reading per track (kick note), shown small under the name. */
  tuner?: (string | null)[]
}

/** Pixels before a press on a melodic step turns into a note drag instead of a click. */
const DRAG_START_PX = 4

/**
 * First click selects the row; in the selected row click = trig, ⌥+click = track ends here. On melodic trigs ↑↓ / wheel / vertical drag = semitone,
 * ⇧ = octave; a horizontal drag paints trigs (or erases, when it starts on a trig). Keyboard: ←→ move along the row, ↑↓ between rows (off melodic trigs), Space/Enter writes a trig.
 */
export function SequencerMatrix({ state, playheads, onToggle, onSetLength, onSetSpeed, onSelect, onSetNote, tuner = [] }: Props) {
  // 'note' = vertical drag on a melodic step, 'paint' = horizontal drag writes (or erases) trigs along the row
  const drag = useRef<{ t: number; s: number; x: number; y: number; note: number; trig: boolean; last: number; mode: 'none' | 'note' | 'paint' } | null>(null)
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
    if (tt !== state.selected) onSelect(tt)
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
    <section ref={root} aria-label="Sequencer"
      onPointerMove={(e) => {
        const t = lengthDrag.current
        if (t === null) return
        const len = stepUnder(t, e.clientX) + 1
        if (len !== state.tracks[t].length) onSetLength(t, len)
      }}
      onPointerUp={() => { lengthDrag.current = null }}
      onPointerCancel={() => { lengthDrag.current = null }}
      className="flex min-h-0 flex-1 flex-col gap-px border-r border-zinc-800 p-2">
      {state.tracks.map((tr, t) => {
        const selected = state.selected === t
        const melodic = isMelodic(t)
        return (
          <div key={tr.name}
            className="grid min-h-0 flex-1 grid-cols-[52px_repeat(16,1fr)_auto] items-stretch gap-px">
            <button type="button" onClick={() => onSelect(t)} aria-pressed={selected}
              className={`flex flex-col justify-center px-1 text-left lowercase leading-tight outline-none focus-visible:ring-1 focus-visible:ring-zinc-100 ${selected ? 'font-bold text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {tr.name}
              {tuner[t] && ' '}{tuner[t] && <span className="text-[9px] tabular-nums text-zinc-400">{tuner[t]}</span>}
            </button>
            {tr.steps.slice(0, VISIBLE).map((st, s) => {
              const beyond = s >= tr.length
              const isEnd = s === tr.length - 1
              const isHead = playheads[t] === s
              const noteEdit = melodic && st.trig
              return (
                <button key={s} type="button" aria-pressed={st.trig} data-track={t} data-step={s}
                  aria-label={melodic ? `${tr.name} step ${s + 1}, ${noteName(st.note)}` : `${tr.name} step ${s + 1}`}
                  onClick={(e) => {
                    if (dragged.current) {
                      dragged.current = false
                      return
                    }
                    // first click only selects the row; writing happens in the selected row
                    if (!selected) {
                      onSelect(t)
                      return
                    }
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
                    dragged.current = false
                    if (!selected || e.altKey) return
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    drag.current = { t, s, x: e.clientX, y: e.clientY, note: st.note, trig: st.trig, last: s, mode: 'none' }
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.t !== t || d.s !== s) return
                    const dx = e.clientX - d.x
                    const dy = d.y - e.clientY
                    if (d.mode === 'none') {
                      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_START_PX) return
                      d.mode = Math.abs(dx) >= Math.abs(dy) ? 'paint' : melodic ? 'note' : 'paint'
                      // the first step flips: painting from an empty step writes, from a trig erases
                      onToggle(t, s)
                      if (d.mode === 'note' && d.trig) onToggle(t, s)
                    }
                    if (d.mode === 'paint') {
                      // fill every step between the last and current one, so fast drags leave no gaps
                      const at = stepUnder(t, e.clientX)
                      for (let i = Math.min(d.last, at); i <= Math.max(d.last, at); i++) {
                        if (i !== s && state.tracks[t].steps[i].trig === d.trig) onToggle(t, i)
                      }
                      d.last = at
                      return
                    }
                    const semis = Math.round(dy / PX_PER_SEMITONE)
                    if (d.note + semis !== st.note) onSetNote(t, s, d.note + semis)
                  }}
                  onPointerUp={() => {
                    dragged.current = (drag.current?.mode ?? 'none') !== 'none'
                    drag.current = null
                  }}
                  onPointerCancel={() => { drag.current = null }}
                  className={[
                    'relative overflow-hidden text-[9px] leading-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100',
                    st.trig ? 'bg-zinc-200 text-black' : selected ? 'bg-zinc-800' : 'bg-zinc-900',
                    beyond ? 'opacity-30 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,#27272a_3px_6px)]' : '',
                    melodic ? 'touch-none' : '',
                    noteEdit ? 'cursor-ns-resize' : '',
                    s % 4 === 0 ? 'ml-0.5' : '',

                    isHead ? 'ring-1 ring-inset ring-zinc-500' : '',
                  ].join(' ')}>
                  {noteEdit ? noteName(st.note) : null}
                  {isEnd && (
                    <span aria-hidden="true" data-length-handle
                      className="absolute inset-y-0 right-0 w-1 cursor-ew-resize touch-none bg-zinc-500 hover:w-1.5 hover:bg-zinc-300"
                      onPointerDown={(e) => {
                        // capture on the section: this handle moves (re-mounts) as the length changes
                        e.stopPropagation()
                        root.current?.setPointerCapture?.(e.pointerId)
                        lengthDrag.current = t
                      }} />
                  )}
                </button>
              )
            })}
            <div className="flex items-center gap-1.5 pl-1.5 text-[10px] text-zinc-400">
              <span role="slider" tabIndex={0} aria-label={`${tr.name} length`} aria-valuemin={1} aria-valuemax={MAX_LENGTH}
                aria-valuenow={tr.length} title="húzd a sáv végét, ⌥+klikk, vagy ←→"
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
                  if (!d) return
                  e.preventDefault()
                  onSetLength(t, Math.min(MAX_LENGTH, Math.max(1, tr.length + d)))
                }}
                className="w-6 text-right tabular-nums text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-zinc-100">
                {tr.length}
              </span>
              <Knob size="xs" tone="mono" label="RATE" ariaLabel={`${tr.name} rate`} steps={SPEED_ORDER.length}
                value={speedIndex(tr.speed) / (SPEED_ORDER.length - 1)} defaultValue={speedIndex(1) / (SPEED_ORDER.length - 1)}
                format={(v) => speedLabel(SPEED_ORDER[Math.round(v * (SPEED_ORDER.length - 1))])}
                onChange={(v) => {
                  const code = SPEED_ORDER[Math.round(v * (SPEED_ORDER.length - 1))]
                  if (code !== tr.speed) onSetSpeed(t, code)
                }} />
              <span className="w-9 tabular-nums text-zinc-400">{speedLabel(tr.speed)}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
