import { useState } from 'react'
import { MACHINES, type MachineDef } from '@/state/machines'
import { rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { AmpEnv } from './AmpEnv'
import { FxGrid } from './FxGrid'
import { Segmented } from './Segmented'
import { ParamKnob } from './ParamKnob'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

export function MachinePanel({ state, frame, store }: Props) {
  const t = state.selected
  const machine = MACHINES[t]
  return (
    <aside aria-label={`${state.tracks[t].name} machine`} className="flex h-full min-h-0 flex-col overflow-y-auto">
      {machine ? (
        // keyed by track so page and selected param reset when switching tracks
        <MachineBody key={t} state={state} frame={frame} store={store} track={t} machine={machine} />
      ) : (
        <p className="p-inset lowercase text-ink-mute">{state.tracks[t].name} · no machine</p>
      )}
    </aside>
  )
}

interface BodyProps extends Props {
  track: number
  machine: MachineDef
}

function MachineBody({ state, frame, store, track: t, machine }: BodyProps) {
  const [page, setPage] = useState(0)
  const [selParam, setSelParam] = useState(machine.pages[0].params[0])

  return (
    <>
      {machine.pages.length > 1 && <div role="tablist" className="flex border-b border-line">
        {machine.pages.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i}
            onClick={() => { setPage(i); setSelParam(pg.params[0]) }}
            className={`flex-1 h-control focus-ring ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-ink-mute'}`}>
            {pg.name}
          </button>
        ))}
      </div>}
      <AmpEnv state={state} frame={frame} store={store} track={t} machine={machine} />
      <div className="grid shrink-0 grid-cols-4 gap-y-tight p-inset">
        {machine.pages[page].params.map((p, i) => (p < 0 ? <div key={`empty${i}`} aria-hidden="true" /> : (
          <ParamKnob key={p} state={state} frame={frame} store={store} row={t} param={p} meta={machine.params[p]}
            selected={selParam === p} onSelect={() => setSelParam(p)} />
        )))}
      </div>
      {machine.switches?.map((sw) => {
        const meta = machine.params[sw.param]
        const opts = meta.display?.kind === 'choice' ? meta.display.options : []
        const last = opts.length - 1
        const idx = Math.round((rowParams(state, t)[sw.param] ?? meta.default) * last)
        return (
          <Segmented key={sw.param} label={sw.label} caption={sw.label} options={opts} index={idx} className="px-inset pb-inset"
            onIndex={(i) => store.setParam(t, sw.param, i / last)} />
        )
      })}
      <FxGrid state={state} frame={frame} store={store} track={t} machine={machine} />
    </>
  )
}
