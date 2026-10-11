import { useState } from 'react'
import { KICK_PAGES, KICK_PARAMS } from '@/state/kickParams'
import { KICK_TRACKS } from '@/state/store'
import type { AppState } from '@/state/types'
import { Knob } from './Knob'

interface Props {
  state: AppState
  onParam(track: number, param: number, value: number): void
}

export function MachinePanel({ state, onParam }: Props) {
  const [page, setPage] = useState(0)
  const t = state.selected
  const track = state.tracks[t]
  if (t >= KICK_TRACKS) {
    return (
      <aside aria-label="Machine" className="p-3 text-zinc-500">
        <b className="text-acc">{track.name}</b>: nincs még machine (későbbi terv).
      </aside>
    )
  }
  return (
    <aside aria-label="Machine" className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <b className="text-acc">{track.name}</b>
        <span className="text-zinc-500">ANALOG BD</span>
      </div>
      <div role="tablist" className="flex border-b border-zinc-800">
        {KICK_PAGES.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i} onClick={() => setPage(i)}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-500'}`}>
            {pg.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-y-4 p-3">
        {KICK_PAGES[page].params.map((p) => (
          <Knob key={p} label={KICK_PARAMS[p].name} value={track.params[p]} defaultValue={KICK_PARAMS[p].default}
            onChange={(v) => onParam(t, p, v)} />
        ))}
      </div>
    </aside>
  )
}
