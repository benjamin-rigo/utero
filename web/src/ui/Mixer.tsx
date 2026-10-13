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

/** One control per master stage (knobs, plus the limit ceiling as a slider); the rest (attack, release, curve, low cut…) keep their defaults. */
const MASTER_COMP = 0
const MASTER_CEIL = 8
const MASTER_KNOBS = [{ param: MASTER_COMP, label: 'comp' }, { param: 6, label: 'eq' }, { param: 4, label: 'sat' }]

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

const BUS_ROWS = ['flt', 'drv', 'pan']

/** The buses on the left unit's columns: a caption column under the track names, each strip two steps wide. */
export function Mixer({ state, frame, store }: Props) {
  const editValue = editValueOf(state)
  return (
    <section aria-label="Mixer" className="col-span-full grid min-h-0 grid-cols-subgrid border-t border-line">
      <div aria-hidden="true" className="col-start-1 flex flex-col gap-tight p-inset text-ink-mute">
        <div className="h-control" />
        <div className="flex flex-col gap-hair">
          {BUS_ROWS.map((r) => <span key={r} className="flex h-control items-center">{r}</span>)}
        </div>
      </div>
      {state.buses.map((bus, b) => {
        const row = busRow(b)
        const meter = frame ? busMeterOf(frame, b) : { peak: 0, rms: 0 }
        const applied = frame ? busMutedOf(frame, b) : bus.muted
        const pending = applied !== bus.muted
        const level = editValue(row, BUS_LEVEL)
        return (
          <div key={bus.name} style={{ gridColumn: `${2 + 2 * b + Math.floor(b / 2)} / span 2` }}
            className={`grid min-h-0 grid-rows-[auto_auto_1fr] gap-tight border-l border-line p-inset ${b === state.buses.length - 1 ? 'border-r' : ''}`}>
            <div className="flex h-control items-center justify-between">
              <span className={`${bus.muted ? 'text-ink-mute line-through' : 'text-ink-soft'}`}>{bus.name}</span>
              <button type="button" aria-label={`Mute ${bus.name}${pending ? ', pending' : ''}`} aria-pressed={bus.muted} onClick={() => store.toggleMute(b)}
                className={`h-control w-control focus-ring ${bus.muted ? 'bg-ink text-on-ink' : 'text-ink-mute hover:text-ink'}`}>
                {pending ? 'q' : 'm'}
              </button>
            </div>
            <div className="flex flex-col gap-hair">
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_FILTER} meta={BUS_PARAMS[BUS_FILTER]} size="slot" bipolar bare label="flt" ariaLabel={`${bus.name} FLT`} />
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_DRIVE} meta={BUS_PARAMS[BUS_DRIVE]} size="slot" bare label="drv" ariaLabel={`${bus.name} DRV`} />
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_PAN} meta={BUS_PARAMS[BUS_PAN]} size="slot" bipolar bare label="pan" ariaLabel={`${bus.name} PAN`} />
            </div>
            <Fader label={`${bus.name} level`} pos={level} defaultPos={faderNormForDb(BUS_DEFAULT_DB[b])} valueText={faderDb(level)}
              meter={meter.peak} onPos={(p) => store.setParam(row, BUS_LEVEL, p)} />
          </div>
        )
      })}
    </section>
  )
}

/** The master on the right unit's four columns: header, comp / eq / sat knobs and the limit slider in 1–3, the upright fader in 4. */
export function Master({ state, frame, store }: Props) {
  const editValue = editValueOf(state)
  const master = frame ? masterMeterOf(frame) : { peakL: 0, peakR: 0, lufs: -70, gr: 0, limGr: 0 }
  const clip = state.master.params[MASTER_MODE] >= 0.5
  return (
    <section aria-label="Master" className="side-grid min-h-0 grid-rows-[var(--spacing-control)_minmax(0,1fr)_var(--spacing-control)] gap-y-tight border-t border-line p-inset">
      <div className="col-span-3 flex h-control items-center gap-group">
        <span className="text-ink-soft">master</span>
        <button type="button" className={toggle(state.muteQuantize)} aria-pressed={state.muteQuantize} aria-label="MUTE Q" onClick={() => store.setMuteQuantize(!state.muteQuantize)}>mute q</button>
        <Segmented label="Master mode" options={['limit', 'clip']} index={clip ? 1 : 0}
          onIndex={(i) => store.setParam(MASTER_ROW, MASTER_MODE, i)} />
        <span className="ml-auto tabular-nums text-ink-soft">{master.lufs.toFixed(1)} lufs</span>
      </div>
      {MASTER_KNOBS.map(({ param, label }) => (
        <div key={param} className="row-start-2 self-center justify-self-center">
          <ParamKnob state={state} frame={frame} store={store} row={MASTER_ROW} param={param} meta={MASTER_PARAMS[param]}
            label={label} ariaLabel={`MASTER ${label}`} reduction={param === MASTER_COMP ? master.gr : undefined} />
        </div>
      ))}
      <div className="col-span-3 row-start-3">
        <ParamKnob state={state} frame={frame} store={store} row={MASTER_ROW} param={MASTER_CEIL} meta={MASTER_PARAMS[MASTER_CEIL]}
          size="slot" label="limit" ariaLabel="MASTER limit" />
      </div>
      <div className="col-start-4 row-span-3 row-start-1 flex min-h-0">
        <Fader label="MASTER level" pos={editValue(MASTER_ROW, MASTER_LEVEL)} defaultPos={MASTER_PARAMS[MASTER_LEVEL].default}
          valueText={outputDb(editValue(MASTER_ROW, MASTER_LEVEL))} meter={Math.max(master.peakL, master.peakR)}
          onPos={(p) => store.setParam(MASTER_ROW, MASTER_LEVEL, p)} />
      </div>
    </section>
  )
}
