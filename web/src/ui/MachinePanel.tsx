import { useState } from 'react'
import { effectiveOf } from '@/audio/snapshot'
import { KICK_PAGES, KICK_PARAMS } from '@/state/kickParams'
import { modLabel } from '@/state/modulation'
import { effectiveValue, KICK_TRACKS, modAmountFor, routeIndexFor, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { Knob } from './Knob'
import { MacroFaders } from './MacroFaders'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const btn = 'rounded border border-zinc-700 px-1.5 text-zinc-300 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc'

export function MachinePanel({ state, frame, store }: Props) {
  const [page, setPage] = useState(0)
  const [selParam, setSelParam] = useState(0)
  const [addSrc, setAddSrc] = useState(0)
  const t = state.selected
  const track = state.tracks[t]

  if (t >= KICK_TRACKS) {
    return (
      <aside aria-label="Machine" className="flex flex-col">
        <p className="p-3 text-zinc-400"><b className="text-acc">{track.name}</b>: nincs még machine (későbbi terv).</p>
        <MacroFaders state={state} store={store} />
      </aside>
    )
  }

  const learn = state.learn
  const selMacro = state.macros[state.selectedMacro]
  const knob = (p: number) => {
    const marker = selMacro.targets.find((x) => x.track === t && x.param === p)
    const learnTarget = learn ? state.macros[learn.macro].targets.find((x) => x.track === t && x.param === p) : undefined
    const base = track.params[p]
    const value = learn ? (learnTarget ? learnTarget[learn.side] : base) : base
    const display = learn ? value : frame ? effectiveOf(frame, t, p) : effectiveValue(state, t, p)
    return (
      <Knob key={p} label={KICK_PARAMS[p].name} value={value} display={display} defaultValue={KICK_PARAMS[p].default}
        modAmount={modAmountFor(state, t, p)} markers={marker ? { a: marker.a, b: marker.b } : null}
        learning={learn !== null} selected={selParam === p}
        onChange={(v) => store.setParam(t, p, v)}
        onSelect={() => setSelParam(p)}
        onDropModulator={(slot) => { store.addRoute(slot, t, p); setSelParam(p) }}
        onModAmount={(delta) => {
          let idx = routeIndexFor(state, state.selectedMod, t, p)
          if (idx === -1) idx = state.routes.findIndex((r) => r !== null && r.track === t && r.param === p)
          const r = state.routes[idx]
          if (r) store.setRouteAmount(idx, r.amount + delta)
        }} />
    )
  }

  const routes = state.routes.flatMap((r, i) => (r && r.track === t && r.param === selParam ? [{ r, i }] : []))
  const active = state.modulators.flatMap((m, i) => (m.kind !== 0 ? [{ m, i }] : []))
  const src = active.some((a) => a.i === addSrc) ? addSrc : active[0]?.i

  return (
    <aside aria-label="Machine" className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <b className="text-acc">{track.name}</b>
        <span className="text-zinc-400">ANALOG BD</span>
      </div>
      <div role="tablist" className="flex border-b border-zinc-800">
        {KICK_PAGES.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i}
            onClick={() => { setPage(i); setSelParam(pg.params[0]) }}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-400'}`}>
            {pg.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-y-2 p-2">{KICK_PAGES[page].params.map(knob)}</div>
      <div className="flex flex-col gap-1 border-t border-zinc-800 p-2">
        <span className="text-[9px] tracking-wider text-zinc-400 uppercase">mod on {KICK_PARAMS[selParam].name}</span>
        {routes.length === 0 && <p className="text-zinc-400">húzz rá egy modulátort a gombra, vagy add hozzá itt</p>}
        {routes.map(({ r, i }) => {
          const name = modLabel(r.src, state.modulators[r.src])
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 text-mod">{name}</span>
              <input type="range" min={-100} max={100} value={Math.round(r.amount * 100)} aria-label={`${name} amount`}
                onChange={(e) => store.setRouteAmount(i, Number(e.target.value) / 100)} className="flex-1 accent-sky-400" />
              <span className="w-8 text-right tabular-nums">{Math.round(r.amount * 100)}</span>
              <button type="button" aria-label={`Remove ${name} route`} onClick={() => store.removeRoute(i)} className={btn}>×</button>
            </div>
          )
        })}
        <div className="flex items-center gap-2">
          <select aria-label="Modulator to add" value={src ?? ''} onChange={(e) => setAddSrc(Number(e.target.value))}
            className="rounded bg-zinc-900 px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc">
            {active.map(({ m, i }) => <option key={i} value={i}>{modLabel(i, m)}</option>)}
          </select>
          <button type="button" className={btn} disabled={src === undefined} aria-disabled={src === undefined}
            onClick={() => { if (src !== undefined) store.addRoute(src, t, selParam) }}>+ route</button>
        </div>
      </div>
      <MacroFaders state={state} store={store} />
    </aside>
  )
}
