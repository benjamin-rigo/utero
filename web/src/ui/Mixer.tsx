import { busMeterOf, busMutedOf, masterMeterOf } from '@/audio/snapshot'
import {
  BUS_DEFAULT_DB, BUS_DRIVE, BUS_FILTER, BUS_LEVEL, BUS_PAN, BUS_PARAMS, busRow, faderDb, faderNormForDb, MASTER_LEVEL, outputDb, MASTER_MODE, MASTER_PARAMS, MASTER_ROW,
} from '@/state/machines'
import { rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { ParamKnob } from './ParamKnob'
import { Fader } from './Fader'
import { Segmented } from './Segmented'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

/** One knob per master stage; the rest (attack, release, curve, low cut…) keep their defaults. */
const MASTER_COMP = 0
const MASTER_CEIL = 8
const MASTER_KNOBS = [
  { param: MASTER_COMP, label: 'comp' }, { param: 6, label: 'eq' }, { param: 4, label: 'sat' }, { param: MASTER_CEIL, label: 'limit' },
]

const toggle = (on: boolean) =>
  `h-control px-tight text-label focus-ring ${on ? 'bg-ink text-on-ink' : 'text-ink-mute hover:text-ink-soft'}`

/** The fader edits the base (or the armed macro endpoint), like every knob. */
const editValueOf = (state: AppState) => (row: number, p: number) => {
  const learn = state.learn
  const base = rowParams(state, row)[p]
  if (!learn) return base
  const t = state.macros[learn.macro].targets.find((x) => x.track === row && x.param === p)
  return t ? t[learn.side] : base
}

/** The eight buses: equal strips across the left unit, the slider names inside the sliders. */
export function Mixer({ state, frame, store }: Props) {
  const editValue = editValueOf(state)
  return (
    <section aria-label="Mixer" className="col-span-full grid min-h-0 grid-cols-[repeat(8,minmax(0,1fr))] gap-hair border-t border-line bg-line">
      {state.buses.map((bus, b) => {
        const row = busRow(b)
        const meter = frame ? busMeterOf(frame, b) : { peak: 0, rms: 0 }
        const applied = frame ? busMutedOf(frame, b) : bus.muted
        const pending = applied !== bus.muted
        const level = editValue(row, BUS_LEVEL)
        return (
          <div key={bus.name} className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-tight bg-background p-inset">
            <div className="flex h-control items-center justify-between">
              <span className={`${bus.muted ? 'text-ink-mute line-through' : 'text-ink-soft'}`}>{bus.name}</span>
              <button type="button" aria-label={`Mute ${bus.name}${pending ? ', pending' : ''}`} aria-pressed={bus.muted} onClick={() => store.toggleMute(b)}
                className={`h-control w-control focus-ring ${bus.muted ? 'bg-ink text-on-ink' : 'text-ink-mute hover:text-ink'}`}>
                {pending ? 'q' : 'm'}
              </button>
            </div>
            <div className="flex flex-col gap-hair">
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_FILTER} meta={BUS_PARAMS[BUS_FILTER]} size="slot" bipolar label="flt" ariaLabel={`${bus.name} FLT`} />
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_DRIVE} meta={BUS_PARAMS[BUS_DRIVE]} size="slot" label="drv" ariaLabel={`${bus.name} DRV`} />
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_PAN} meta={BUS_PARAMS[BUS_PAN]} size="slot" bipolar label="pan" ariaLabel={`${bus.name} PAN`} />
            </div>
            <Fader label={`${bus.name} level`} pos={level} defaultPos={faderNormForDb(BUS_DEFAULT_DB[b])} valueText={faderDb(level)}
              meter={meter.peak} onPos={(p) => store.setParam(row, BUS_LEVEL, p)} />
          </div>
        )
      })}
    </section>
  )
}

/** The master: header, comp / eq / sat / limit knobs (centred), the narrow upright output fader at the right. */
export function Master({ state, frame, store }: Props) {
  const editValue = editValueOf(state)
  const master = frame ? masterMeterOf(frame) : { peakL: 0, peakR: 0, lufs: -70, gr: 0, limGr: 0 }
  const clip = state.master.params[MASTER_MODE] >= 0.5
  return (
    <section aria-label="Master" className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--spacing-fader)] gap-group border-t border-line p-inset">
      <div className="flex min-h-0 flex-col gap-tight">
        <div className="flex h-control items-center gap-group">
          <span className="text-ink-soft">master</span>
          <button type="button" className={toggle(state.muteQuantize)} aria-pressed={state.muteQuantize} aria-label="MUTE Q" onClick={() => store.setMuteQuantize(!state.muteQuantize)}>mute q</button>
          <Segmented label="Master mode" options={['limit', 'clip']} index={clip ? 1 : 0}
            onIndex={(i) => store.setParam(MASTER_ROW, MASTER_MODE, i)} />
          <span className="ml-auto tabular-nums text-ink-soft">{master.lufs.toFixed(1)} lufs</span>
        </div>
        <div className="knob-row flex-1 content-center">
          {MASTER_KNOBS.map(({ param, label }) => (
            <ParamKnob key={param} state={state} frame={frame} store={store} row={MASTER_ROW} param={param} meta={MASTER_PARAMS[param]}
              label={label} ariaLabel={`MASTER ${label}`}
              reduction={param === MASTER_COMP ? master.gr : param === MASTER_CEIL && !clip ? master.limGr : undefined} />
          ))}
        </div>
      </div>
      <Fader label="MASTER level" pos={editValue(MASTER_ROW, MASTER_LEVEL)} defaultPos={MASTER_PARAMS[MASTER_LEVEL].default}
        valueText={outputDb(editValue(MASTER_ROW, MASTER_LEVEL))} meter={Math.max(master.peakL, master.peakR)}
        onPos={(p) => store.setParam(MASTER_ROW, MASTER_LEVEL, p)} />
    </section>
  )
}
