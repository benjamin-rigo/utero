import { useState, type KeyboardEvent } from 'react'
import { MACHINES, type MachineDef } from '@/state/machines'
import { modLabel } from '@/state/modulation'
import { rowParams, type Store } from '@/state/store'
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
    <aside aria-label={`${state.tracks[t].name} machine`} className="flex min-h-0 flex-col">
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
  const routes = state.routes.flatMap((r, i) => (r && r.track === t && r.param === selParam ? [{ r, i }] : []))
  const label = (slot: number) => (state.modulators[slot].kind === 0 ? `MOD${slot + 1} (off)` : modLabel(slot, state.modulators[slot]))

  return (
    <>
      {machine.pages.length > 1 && <div role="tablist" className="flex border-b border-zinc-800">
        {machine.pages.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i}
            onClick={() => { setPage(i); setSelParam(pg.params[0]) }}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-400'}`}>
            {pg.name}
          </button>
        ))}
      </div>}
      {machine.switches?.map((sw) => {
        const meta = machine.params[sw.param]
        const opts = meta.display?.kind === 'choice' ? meta.display.options : []
        const last = opts.length - 1
        const idx = Math.round((rowParams(state, t)[sw.param] ?? meta.default) * last)
        const pick = (i: number) => store.setParam(t, sw.param, Math.min(last, Math.max(0, i)) / last)
        const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
          e.preventDefault()
          const n = Math.min(last, Math.max(0, i))
          pick(n)
          ;(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n])?.focus()
        }
        return (
          <div key={sw.param} role="radiogroup" aria-label={sw.label} className="flex items-center gap-1 px-2 pt-2 text-[10px]">
            <span className="mr-1 text-zinc-400">{sw.label}</span>
            {opts.map((o, i) => (
              <button key={o} type="button" role="radio" aria-checked={i === idx} tabIndex={i === idx ? 0 : -1}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, idx + 1)
                  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, idx - 1)
                  else if (e.key === 'Home') move(e, 0)
                  else if (e.key === 'End') move(e, last)
                }}
                className={`min-w-8 rounded border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${i === idx ? 'border-acc text-acc' : 'border-zinc-700 text-zinc-300'}`}>
                {o}
              </button>
            ))}
          </div>
        )
      })}
      <div className="grid grid-cols-4 gap-y-2 p-2">
        {machine.pages[page].params.map((p) => (
          <ParamKnob key={p} state={state} frame={frame} store={store} row={t} param={p} meta={machine.params[p]}
            selected={selParam === p} onSelect={() => setSelParam(p)} />
        ))}
      </div>
      {(state.mapping || routes.length > 0) && (
        <div className="flex min-h-7 flex-wrap items-center gap-1 border-t border-zinc-800 px-2 py-1">
          {state.mapping ? (
            <span className="text-mod">
              MAP {label(state.selectedMod)}: húzd a gombokat a mértékhez · dupla katt törli ·{' '}
              <button type="button" className={btn} onClick={() => store.setMapping(false)}>kész (Esc)</button>
            </span>
          ) : (
            <>
              <span className="mr-1 text-zinc-400">{machine.params[selParam].name}</span>
              {routes.map(({ r, i }) => (
                <span key={i} className="flex items-center gap-1 rounded-full border border-mod/50 py-0.5 pr-0.5 pl-2">
                  <span className="text-mod">{label(r.src)}</span>
                  <span className="tabular-nums">{r.amount > 0 ? '+' : ''}{Math.round(r.amount * 100)}</span>
                  <button type="button" aria-label={`Remove ${label(r.src)} route`} onClick={() => store.removeRoute(i)}
                    className="rounded-full px-1 text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc">×</button>
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}
