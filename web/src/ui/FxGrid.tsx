import { useState } from 'react'
import {
  FILTER_MODES, FX_BASE, FX_DELAY, FX_FILTER, FX_FILTER_MODE, FX_NAMES, FX_REVERB, MASTER_DELAY, MASTER_PARAMS, MASTER_REVERB, MASTER_ROW,
  type MachineDef,
} from '@/state/machines'
import { rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { ParamKnob } from './ParamKnob'

const FX_DRAG_TYPE = 'application/x-utero-fx'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
  track: number
  machine: MachineDef
}

/**
 * The machine's insert chain: knob order = signal order. Drag a label onto another knob to move it,
 * click the filter to cycle lp → hp → comb, double-click delay / reverb for their (global) settings.
 */
export function FxGrid({ state, frame, store, track: t, machine }: Props) {
  const [page, setPage] = useState<'delay' | 'reverb' | null>(null)
  const order = state.tracks[t].fxOrder
  const mode = Math.round((rowParams(state, t)[FX_FILTER_MODE] ?? 0) * (FILTER_MODES.length - 1))

  if (page) {
    const params = page === 'delay' ? MASTER_DELAY : MASTER_REVERB
    return (
      <section aria-label={`${page} settings`} className="border-t border-zinc-800">
        <button type="button" onClick={() => setPage(null)}
          className="w-full px-2 py-1 text-left text-[10px] lowercase text-zinc-300 outline-none hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100">
          ‹ {page}
        </button>
        <div className="grid grid-cols-4 gap-y-2 p-2">
          {params.map((p) => (
            <ParamKnob key={p} state={state} frame={frame} store={store} row={MASTER_ROW} param={p} meta={MASTER_PARAMS[p]}
              label={MASTER_PARAMS[p].name.split(' ')[1].toLowerCase()} ariaLabel={MASTER_PARAMS[p].name} />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Insert FX" className="grid grid-cols-4 gap-y-2 border-t border-zinc-800 p-2">
      {order.map((id, pos) => {
        const param = FX_BASE + id
        const label = id === FX_FILTER ? FILTER_MODES[mode] : FX_NAMES[id]
        return (
          <div key={id}
            onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes(FX_DRAG_TYPE)) e.preventDefault() }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(FX_DRAG_TYPE)
              if (raw === '') return
              e.preventDefault()
              store.moveFx(t, Number(raw), pos)
            }}>
            <ParamKnob state={state} frame={frame} store={store} row={t} param={param} meta={machine.params[param]}
              label={label} ariaLabel={FX_NAMES[id]}
              onLabelDragStart={(e) => {
                e.dataTransfer.setData(FX_DRAG_TYPE, String(pos))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onTap={id === FX_FILTER ? () => store.setParam(t, FX_FILTER_MODE, ((mode + 1) % FILTER_MODES.length) / (FILTER_MODES.length - 1)) : undefined}
              // filter: double-click is just two taps (two mode steps), never a reset to 0 = bypass
              onOpen={id === FX_DELAY ? () => setPage('delay') : id === FX_REVERB ? () => setPage('reverb') : id === FX_FILTER ? () => {} : undefined} />
          </div>
        )
      })}
    </section>
  )
}
