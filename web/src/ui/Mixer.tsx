import { busMeterOf, busMutedOf, masterMeterOf } from '@/audio/snapshot'
import {
  BUS_DEFAULT_DB, BUS_DRIVE, BUS_FILTER, BUS_LEVEL, BUS_PARAMS, busRow, faderDb, faderNormForDb, MASTER_LEVEL, MASTER_MODE, MASTER_PARAMS, MASTER_ROW,
} from '@/state/machines'
import { rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { ParamKnob } from './ParamKnob'
import { Fader } from './Fader'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const toggle = (on: boolean) =>
  `px-1 text-[10px] lowercase outline-none focus-visible:ring-1 focus-visible:ring-acc ${on ? 'text-acc' : 'text-zinc-400 hover:text-zinc-200'}`

export function Mixer({ state, frame, store }: Props) {
  // The fader edits the base (or the armed macro endpoint), like every knob.
  const editValue = (row: number, p: number) => {
    const learn = state.learn
    const base = rowParams(state, row)[p]
    if (!learn) return base
    const t = state.macros[learn.macro].targets.find((x) => x.track === row && x.param === p)
    return t ? t[learn.side] : base
  }
  const master = frame ? masterMeterOf(frame) : { peakL: 0, peakR: 0, lufs: -70, gr: 0 }
  const clip = state.master.params[MASTER_MODE] >= 0.5

  return (
    <section aria-label="Mixer" className="grid h-full min-h-0 grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,2.4fr)] gap-px border-t border-zinc-800 bg-zinc-800 text-[10px]">
      {state.buses.map((bus, b) => {
        const row = busRow(b)
        const meter = frame ? busMeterOf(frame, b) : { peak: 0, rms: 0 }
        const applied = frame ? busMutedOf(frame, b) : bus.muted
        const pending = applied !== bus.muted
        const level = editValue(row, BUS_LEVEL)
        return (
          <div key={bus.name} className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-1 bg-background p-1.5">
            <div className="flex items-center justify-between">
              <span className={`lowercase ${bus.muted ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>{bus.name}</span>
              <button type="button" aria-label={`Mute ${bus.name}${pending ? ', pending' : ''}`} aria-pressed={bus.muted} onClick={() => store.toggleMute(b)}
                className={`w-5 outline-none focus-visible:ring-1 focus-visible:ring-acc ${bus.muted ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}>
                {pending ? 'q' : 'm'}
              </button>
            </div>
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-0.5">
                <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_FILTER} meta={BUS_PARAMS[BUS_FILTER]} size="xs" ariaLabel={`${bus.name} FLT`} />flt
              </span>
              <span className="flex items-center gap-0.5">
                <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_DRIVE} meta={BUS_PARAMS[BUS_DRIVE]} size="xs" ariaLabel={`${bus.name} DRV`} />drv
              </span>
            </div>
            <Fader label={`${bus.name} level`} pos={level} defaultPos={faderNormForDb(BUS_DEFAULT_DB[b])} valueText={faderDb(level)}
              meter={meter.peak} onPos={(p) => store.setParam(row, BUS_LEVEL, p)} />
          </div>
        )
      })}
      <div className="grid min-h-0 grid-cols-[1fr_3rem] gap-2 bg-background p-1.5">
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="mr-1 text-zinc-200">master</span>
            <button type="button" className={toggle(state.muteQuantize)} aria-pressed={state.muteQuantize} aria-label="MUTE Q" onClick={() => store.setMuteQuantize(!state.muteQuantize)}>mute q</button>
            <button type="button" className={toggle(clip)} aria-label="Master CLIP" aria-pressed={clip} title={clip ? 'soft clip' : 'limiter'}
              onClick={() => store.setParam(MASTER_ROW, MASTER_MODE, clip ? 0 : 1)}>{clip ? 'clip' : 'limit'}</button>
            <span className="ml-auto tabular-nums text-zinc-300">{master.lufs.toFixed(1)} lufs · gr {master.gr.toFixed(1)}</span>
          </div>
          <div className="grid grid-cols-5 gap-x-1 gap-y-0.5">
            {MASTER_PARAMS.map((meta, p) => (p === MASTER_MODE || p === MASTER_LEVEL ? null : (
              <ParamKnob key={meta.name} state={state} frame={frame} store={store} row={MASTER_ROW} param={p} meta={meta} size="sm" ariaLabel={`MASTER ${meta.name}`} />
            )))}
          </div>
        </div>
        <Fader label="MASTER level" pos={editValue(MASTER_ROW, MASTER_LEVEL)} defaultPos={MASTER_PARAMS[MASTER_LEVEL].default}
          valueText={faderDb(editValue(MASTER_ROW, MASTER_LEVEL))} meter={Math.max(master.peakL, master.peakR)}
          onPos={(p) => store.setParam(MASTER_ROW, MASTER_LEVEL, p)} />
      </div>
    </section>
  )
}
