import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { KICK_PARAMS } from '@/state/kickParams'
import type { Store } from '@/state/store'
import type { AppState } from '@/state/types'

interface Props {
  state: AppState
  store: Store
}

export function MacroFaders({ state, store }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const cancelRename = useRef(false)
  const sel = state.macros[state.selectedMacro]
  const paramName = (t: number, p: number) => `${state.tracks[t]?.name}.${KICK_PARAMS[p]?.name ?? p}`
  const hint = state.learn
    ? `${state.macros[state.learn.macro].name} · ${state.learn.side.toUpperCase()} élesítve: amit most tekersz, az lesz a ${state.learn.side.toUpperCase()} állapot`
    : sel.targets.length
      ? null
      : `${sel.name}: nincs cél – nyomd meg az A-t vagy a B-t, és tekerj`
  const startRename = (m: number) => { cancelRename.current = false; setEditing(m) }

  return (
    <section aria-label="Macros" className="flex min-h-0 flex-1 flex-col gap-1 border-t border-zinc-800 p-2">
      <span className="text-[9px] tracking-wider text-zinc-400 uppercase">macros · A ↔ B</span>
      <div className="grid min-h-0 flex-1 grid-cols-8 gap-1.5">
        {state.macros.map((mac, m) => {
          const armed = state.learn?.macro === m ? state.learn.side : null
          return (
            <div key={m} className="grid min-h-0 grid-rows-[auto_auto_1fr_auto_auto] justify-items-center gap-1">
              <ArmButton label={`${mac.name} B`} side="b" armed={armed === 'b'} onClick={() => store.armLearn(m, 'b')} />
              {editing === m ? (
                <input aria-label={`Rename ${mac.name}`} autoFocus defaultValue={mac.name}
                  className="w-full rounded bg-zinc-900 text-center text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc"
                  onBlur={(e) => {
                    if (!cancelRename.current) store.renameMacro(m, e.target.value)
                    cancelRename.current = false
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { cancelRename.current = true; setEditing(null) }
                  }} />
              ) : (
                <button type="button" aria-pressed={state.selectedMacro === m} onClick={() => store.selectMacro(m)} onDoubleClick={() => startRename(m)}
                  onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); startRename(m) } }} aria-keyshortcuts="F2"
                  className={`max-w-full truncate rounded text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc ${state.selectedMacro === m ? 'text-acc' : 'text-zinc-200'}`}>
                  {mac.name}
                </button>
              )}
              <Fader name={mac.name} pos={mac.pos} empty={mac.targets.length === 0} onPos={(p) => store.setMacroPos(m, p)} />
              <ArmButton label={`${mac.name} A`} side="a" armed={armed === 'a'} onClick={() => store.armLearn(m, 'a')} />
              <span className="text-[8px] text-zinc-400">{mac.targets.length} param</span>
            </div>
          )
        })}
      </div>
      {hint && <p className="truncate text-[9px] text-zinc-400">{hint}</p>}
      {sel.targets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sel.targets.map((t, i) => {
            const name = paramName(t.track, t.param)
            return (
              <button key={i} type="button" aria-label={`Remove ${name} from ${sel.name}`} onClick={() => store.removeMacroTarget(state.selectedMacro, i)}
                className="rounded border border-zinc-700 px-1 text-[9px] text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-acc">
                {name} ×
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ArmButton({ label, side, armed, onClick }: { label: string; side: 'a' | 'b'; armed: boolean; onClick(): void }) {
  return (
    <button type="button" aria-label={`Learn ${label}`} aria-pressed={armed} onClick={onClick}
      className={[
        'w-full rounded border text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc',
        armed ? 'border-red-600 bg-red-600 text-white ring-2 ring-red-300' : side === 'b' ? 'border-sky-900 text-mod' : 'border-zinc-500 text-zinc-300',
      ].join(' ')}>
      {side.toUpperCase()}
    </button>
  )
}

function Fader({ name, pos, empty, onPos }: { name: string; pos: number; empty: boolean; onPos(p: number): void }) {
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onPos(Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const keys: Record<string, number> = {
      ArrowUp: pos + step, ArrowRight: pos + step, ArrowDown: pos - step, ArrowLeft: pos - step, Home: 0, End: 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      onPos(Math.min(1, Math.max(0, keys[e.key])))
    }
  }
  return (
    <div role="slider" tabIndex={0} aria-label={`${name} macro`} aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e) }}
      onPointerMove={(e) => { if (e.buttons) fromPointer(e) }}
      onKeyDown={onKey}
      className="relative flex h-full min-h-10 w-full cursor-ns-resize touch-none justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-acc">
      <div className={`h-full w-2 rounded ${empty ? 'bg-zinc-800' : 'bg-gradient-to-t from-zinc-700 to-sky-900'}`} />
      <div className="absolute left-1/2 h-3 w-7 -translate-x-1/2 rounded-sm bg-zinc-200 shadow" style={{ bottom: `calc(${pos * 100}% - 6px)` }} />
    </div>
  )
}
