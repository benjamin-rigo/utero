import { useRef, useState } from 'react'
import { paramLabel } from '@/state/machines'
import type { Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { Fader } from './Fader'

interface Props {
  state: AppState
  store: Store
}

export function MacroFaders({ state, store }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const cancelRename = useRef(false)
  const sel = state.macros[state.selectedMacro]
  const paramName = (row: number, p: number) => paramLabel(state.tracks.map((t) => t.name), row, p)
  const startRename = (m: number) => { cancelRename.current = false; setEditing(m) }

  return (
    <section aria-label="Macros" className="flex min-h-0 flex-col gap-tight p-inset">
      <div className="grid min-h-0 flex-1 grid-cols-8 gap-tight">
        {state.macros.map((mac, m) => {
          const armed = state.learn?.macro === m ? state.learn.side : null
          const selected = state.selectedMacro === m
          return (
            <div key={m} className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] gap-tight">
              <div className="flex h-control items-center justify-between gap-tight text-label">
                {editing === m ? (
                  <input aria-label={`Rename ${mac.name}`} autoFocus defaultValue={mac.name}
                    className="w-full min-w-0 bg-well text-label focus-ring"
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
                  <button type="button" aria-pressed={selected} onClick={() => store.selectMacro(m)} onDoubleClick={() => startRename(m)}
                    onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); startRename(m) } }} aria-keyshortcuts="F2"
                    className={`h-full min-w-0 truncate focus-ring ${selected ? 'font-bold text-ink' : 'text-ink-mute'}`}>
                    {mac.name}
                  </button>
                )}
                {mac.targets.length > 0 && (
                  <span className="tabular-nums text-ink-mute" aria-label={`${mac.targets.length} targets`}>{mac.targets.length}</span>
                )}
              </div>
              <ArmButton label={`${mac.name} A`} side="a" armed={armed === 'a'} onClick={() => store.armLearn(m, 'a')} />
              <Fader label={`${mac.name} macro`} pos={mac.pos} defaultPos={0} empty={mac.targets.length === 0} tone="mod" invert
                valueText={`${Math.round(mac.pos * 100)}`} onPos={(p) => store.setMacroPos(m, p)} />
              <ArmButton label={`${mac.name} B`} side="b" armed={armed === 'b'} onClick={() => store.armLearn(m, 'b')} />
            </div>
          )
        })}
      </div>
      {sel.targets.length > 0 && (
        <div className="flex h-control gap-tight overflow-x-auto whitespace-nowrap">
          {sel.targets.map((t, i) => {
            const name = paramName(t.track, t.param)
            return (
              <button key={i} type="button" aria-label={`Remove ${name} from ${sel.name}`} onClick={() => store.removeMacroTarget(state.selectedMacro, i)}
                className="px-tight text-label text-ink-mute hover:text-ink focus-ring">
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
        'h-control w-full text-label focus-ring',
        armed ? 'bg-alert text-ink ring-1 ring-alert-soft' : 'bg-well text-ink-soft hover:text-ink',
      ].join(' ')}>
      {side.toUpperCase()}
    </button>
  )
}
