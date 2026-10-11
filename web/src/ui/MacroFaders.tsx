import { useRef, useState } from 'react'
import { paramLabel } from '@/state/machines'
import type { Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { VFader } from './VFader'

interface Props {
  state: AppState
  store: Store
}

export function MacroFaders({ state, store }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const cancelRename = useRef(false)
  const sel = state.macros[state.selectedMacro]
  const paramName = (row: number, p: number) => paramLabel(state.tracks.map((t) => t.name), row, p)
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
              <VFader label={`${mac.name} macro`} pos={mac.pos} empty={mac.targets.length === 0} onPos={(p) => store.setMacroPos(m, p)} />
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
