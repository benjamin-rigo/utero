import { useRef, type KeyboardEvent } from 'react'
import { isMelodic, noteName } from '@/state/machines'
import type { AppState } from '@/state/types'

export const SPEEDS = [
  { code: 0, label: '1/32' }, { code: 1, label: '1/16' }, { code: 2, label: '1/8' }, { code: 3, label: '1/4' },
  { code: 4, label: '1 BAR' }, { code: 5, label: '1/16T' }, { code: 6, label: '1/8T' },
]
const VISIBLE = 16
const PX_PER_SEMITONE = 8

interface Props {
  state: AppState
  playheads: number[]
  onToggle(track: number, step: number): void
  onSetLength(track: number, length: number): void
  onSetSpeed(track: number, code: number): void
  onSelect(track: number): void
  onSetMode(mode: 'trig' | 'note'): void
  onSetNote(track: number, step: number, note: number): void
}

/** TRIG: click = trig, ⌥+click = track ends here. NOTE: ↑↓ / wheel / drag = semitone, ⇧ = octave. */
export function SequencerMatrix({ state, playheads, onToggle, onSetLength, onSetSpeed, onSelect, onSetMode, onSetNote }: Props) {
  const noteMode = state.editMode === 'note'
  const drag = useRef<{ t: number; s: number; y: number; note: number } | null>(null)

  const onNoteKey = (e: KeyboardEvent, t: number, s: number, note: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const step = e.shiftKey ? 12 : 1
    onSetNote(t, s, note + (e.key === 'ArrowUp' ? step : -step))
  }

  return (
    <section aria-label="Sequencer" className="flex min-h-0 flex-1 flex-col gap-[3px] border-r border-zinc-800 p-2">
      <div role="group" aria-label="Edit mode" className="flex items-center gap-1 pb-1 text-[10px]">
        {(['trig', 'note'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={state.editMode === m} onClick={() => onSetMode(m)}
            className={`rounded border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${state.editMode === m ? 'border-acc text-acc' : 'border-zinc-700 text-zinc-400'}`}>
            {m.toUpperCase()}
          </button>
        ))}
        <span className="ml-2 text-zinc-400">{noteMode ? '↑↓ / görgő / húzás = hang · ⇧ = oktáv' : '⌥+klikk = sávhossz'}</span>
      </div>
      {state.tracks.map((tr, t) => {
        const newBus = t > 0 && state.tracks[t - 1].bus !== tr.bus
        const selected = state.selected === t
        const melodic = isMelodic(t)
        const inert = noteMode && !melodic
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
              const showNote = noteMode && melodic
              return (
                <button key={s} type="button" aria-pressed={st.trig} aria-disabled={inert || undefined}
                  aria-label={showNote ? `${tr.name} step ${s + 1}, ${noteName(st.note)}` : `${tr.name} step ${s + 1}`}
                  onClick={(e) => {
                    if (e.altKey) onSetLength(t, s + 1)
                    else if (!noteMode) onToggle(t, s)
                  }}
                  onKeyDown={(e) => { if (showNote) onNoteKey(e, t, s, st.note) }}
                  onWheel={(e) => { if (showNote) onSetNote(t, s, st.note + (e.deltaY < 0 ? 1 : -1)) }}
                  onPointerDown={(e) => {
                    if (!showNote) return
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    drag.current = { t, s, y: e.clientY, note: st.note }
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.t !== t || d.s !== s) return
                    const semis = Math.round((d.y - e.clientY) / PX_PER_SEMITONE)
                    if (d.note + semis !== st.note) onSetNote(t, s, d.note + semis)
                  }}
                  onPointerUp={() => { drag.current = null }}
                  onPointerCancel={() => { drag.current = null }}
                  className={[
                    'relative overflow-hidden rounded-sm text-[9px] leading-none text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                    st.trig ? 'bg-acc/70' : 'bg-zinc-900',
                    beyond ? 'opacity-30 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,#27272a_3px_6px)]' : '',
                    inert ? 'opacity-40' : '',
                    showNote ? 'cursor-ns-resize touch-none' : '',
                    s % 4 === 0 ? 'ml-0.5' : '',
                    isEnd ? 'border-r-2 border-acc' : '',
                    isHead ? 'ring-1 ring-zinc-200' : '',
                  ].join(' ')}>
                  {showNote && st.trig ? noteName(st.note) : null}
                </button>
              )
            })}
            <div className="flex items-center justify-end gap-1 pl-2 text-[10px] text-zinc-400">
              <button type="button" aria-label={`${tr.name} shorter`} onClick={() => onSetLength(t, tr.length - 1)}
                className="rounded px-1 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc">−</button>
              <span className="w-6 text-center tabular-nums text-zinc-100" aria-label={`${tr.name} length`}>{tr.length}</span>
              <button type="button" aria-label={`${tr.name} longer`} onClick={() => onSetLength(t, tr.length + 1)}
                className="rounded px-1 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc">+</button>
              <select aria-label={`${tr.name} speed`} value={tr.speed} onChange={(e) => onSetSpeed(t, Number(e.target.value))}
                className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-300 focus-visible:ring-2 focus-visible:ring-acc">
                {SPEEDS.map((sp) => <option key={sp.code} value={sp.code}>{sp.label}</option>)}
              </select>
            </div>
          </div>
        )
      })}
    </section>
  )
}
