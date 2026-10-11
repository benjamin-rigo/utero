import { useState } from 'react'
import { MACHINES, type MachineDef } from '@/state/machines'
import { modLabel } from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { MacroFaders } from './MacroFaders'
import { ParamKnob } from './ParamKnob'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const btn = 'rounded border border-zinc-700 px-1.5 text-zinc-300 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc disabled:opacity-40'

export function MachinePanel({ state, frame, store }: Props) {
  const t = state.selected
  const machine = MACHINES[t]
  return (
    <aside aria-label="Machine" className="flex min-h-0 flex-col">
      {machine ? (
        // keyed by track so page and selected param reset when switching tracks
        <MachineBody key={t} state={state} frame={frame} store={store} track={t} machine={machine} />
      ) : (
        <p className="p-3 text-zinc-400"><b className="text-acc">{state.tracks[t].name}</b>: nincs még machine (későbbi terv).</p>
      )}
      <MacroFaders state={state} store={store} />
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
  const [addSrc, setAddSrc] = useState(0)
  const routes = state.routes.flatMap((r, i) => (r && r.track === t && r.param === selParam ? [{ r, i }] : []))
  const active = state.modulators.flatMap((m, i) => (m.kind !== 0 ? [{ m, i }] : []))
  const src = active.some((a) => a.i === addSrc) ? addSrc : active[0]?.i
  const label = (slot: number) => (state.modulators[slot].kind === 0 ? `MOD${slot + 1} (off)` : modLabel(slot, state.modulators[slot]))

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <b className="text-acc">{state.tracks[t].name}</b>
        <span className="text-zinc-400">{machine.name}</span>
      </div>
      <div role="tablist" className="flex border-b border-zinc-800">
        {machine.pages.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i}
            onClick={() => { setPage(i); setSelParam(pg.params[0]) }}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-400'}`}>
            {pg.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-y-2 p-2">
        {machine.pages[page].params.map((p) => (
          <ParamKnob key={p} state={state} frame={frame} store={store} row={t} param={p} meta={machine.params[p]}
            selected={selParam === p} onSelect={() => setSelParam(p)} />
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-zinc-800 p-2">
        <span className="text-[9px] tracking-wider text-zinc-400 uppercase">mod on {machine.params[selParam].name}</span>
        {routes.length === 0 && <p className="text-zinc-400">húzz rá egy modulátort a gombra, vagy add hozzá itt</p>}
        {routes.map(({ r, i }) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-16 text-mod">{label(r.src)}</span>
            <input type="range" min={-100} max={100} value={Math.round(r.amount * 100)} aria-label={`${label(r.src)} amount`}
              onChange={(e) => store.setRouteAmount(i, Number(e.target.value) / 100)} className="flex-1 accent-sky-400" />
            <span className="w-8 text-right tabular-nums">{Math.round(r.amount * 100)}</span>
            <button type="button" aria-label={`Remove ${label(r.src)} route`} onClick={() => store.removeRoute(i)} className={btn}>×</button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select aria-label="Modulator to add" value={src ?? ''} onChange={(e) => setAddSrc(Number(e.target.value))}
            className="rounded bg-zinc-900 px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc">
            {active.map(({ m, i }) => <option key={i} value={i}>{modLabel(i, m)}</option>)}
          </select>
          <button type="button" className={btn} disabled={src === undefined} aria-disabled={src === undefined}
            onClick={() => { if (src !== undefined) store.addRoute(src, t, selParam) }}>+ route</button>
        </div>
      </div>
    </>
  )
}
