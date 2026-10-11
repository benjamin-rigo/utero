import { busMeterOf, busMutedOf, effectiveOf, masterMeterOf } from '@/audio/snapshot'
import { BUS_FILTER, BUS_DRIVE, BUS_LEVEL, BUS_PARAMS, busRow, faderDb, MASTER_LEVEL, MASTER_MODE, MASTER_PARAMS, MASTER_ROW } from '@/state/machines'
import { effectiveValue, rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { ParamKnob } from './ParamKnob'
import { VFader } from './VFader'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const toggle = (on: boolean) =>
  `rounded border px-1.5 py-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc ${on ? 'border-acc text-acc' : 'border-zinc-700 text-zinc-300'}`

/** Peak meter: −60…0 dBFS mapped to the bar height. */
function Meter({ label, peak }: { label: string; peak: number }) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -60
  const h = Math.min(100, Math.max(0, ((db + 60) / 60) * 100))
  return (
    <div role="img" aria-label={`${label} ${db <= -60 ? '−∞' : db.toFixed(1)} dB`} className="relative w-1.5 overflow-hidden rounded bg-zinc-900">
      <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500" style={{ height: `${h}%` }} />
    </div>
  )
}

export function Mixer({ state, frame, store }: Props) {
  // The fader edits the base (or the armed macro endpoint), like every knob.
  const editValue = (row: number, p: number) => {
    const learn = state.learn
    const base = rowParams(state, row)[p]
    if (!learn) return base
    const t = state.macros[learn.macro].targets.find((x) => x.track === row && x.param === p)
    return t ? t[learn.side] : base
  }
  const live = (row: number, p: number) => (frame ? effectiveOf(frame, row, p) : effectiveValue(state, row, p))
  const master = frame ? masterMeterOf(frame) : { peakL: 0, peakR: 0, lufs: -70, gr: 0 }
  const clip = state.master.params[MASTER_MODE] >= 0.5

  return (
    <section aria-label="Mixer" className="grid h-full min-h-0 grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,2.4fr)] border-t border-zinc-800 text-[10px]">
      {state.buses.map((bus, b) => {
        const row = busRow(b)
        const meter = frame ? busMeterOf(frame, b) : { peak: 0, rms: 0 }
        const applied = frame ? busMutedOf(frame, b) : bus.muted
        const pending = applied !== bus.muted
        return (
          <div key={bus.name} className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] gap-1 border-r border-zinc-800 p-1.5">
            <div className="flex justify-between">
              <b>{bus.name}</b>
              <span className="tabular-nums text-zinc-400">{faderDb(live(row, BUS_LEVEL))}</span>
            </div>
            <div className="flex justify-center gap-1">
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_FILTER} meta={BUS_PARAMS[BUS_FILTER]} size="sm" ariaLabel={`${bus.name} FLT`} />
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_DRIVE} meta={BUS_PARAMS[BUS_DRIVE]} size="sm" ariaLabel={`${bus.name} DRV`} />
            </div>
            <div className="flex min-h-0 justify-center gap-1.5">
              <div className="w-8"><VFader label={`${bus.name} level`} pos={editValue(row, BUS_LEVEL)} valueText={faderDb(editValue(row, BUS_LEVEL))} onPos={(p) => store.setParam(row, BUS_LEVEL, p)} /></div>
              <Meter label={`${bus.name} peak`} peak={meter.peak} />
            </div>
            <button type="button" aria-label={`Mute ${bus.name}${pending ? ', pending' : ''}`} aria-pressed={bus.muted} onClick={() => store.toggleMute(b)}
              className={`rounded border py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${bus.muted ? 'border-red-600 bg-red-600 text-white' : 'border-zinc-700 text-zinc-300'}`}>
              {bus.muted ? 'MUTED' : 'MUTE'}{pending ? ' · Q' : ''}
            </button>
          </div>
        )
      })}
      <div className="grid min-h-0 grid-cols-[1fr_auto] gap-2 p-1.5">
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <b>MASTER</b>
            <button type="button" className={toggle(state.muteQuantize)} aria-pressed={state.muteQuantize} onClick={() => store.setMuteQuantize(!state.muteQuantize)}>MUTE Q</button>
            <button type="button" className={toggle(clip)} aria-label="Master CLIP" aria-pressed={clip} title={clip ? 'soft clip' : 'limiter'}
              onClick={() => store.setParam(MASTER_ROW, MASTER_MODE, clip ? 0 : 1)}>CLIP</button>
            <span className="ml-auto tabular-nums text-zinc-300">{master.lufs.toFixed(1)} LUFS · GR {master.gr.toFixed(1)} dB</span>
          </div>
          <div className="grid grid-cols-5 gap-x-1 gap-y-0.5">
            {MASTER_PARAMS.map((meta, p) => (p === MASTER_MODE || p === MASTER_LEVEL ? null : (
              <ParamKnob key={meta.name} state={state} frame={frame} store={store} row={MASTER_ROW} param={p} meta={meta} size="sm" ariaLabel={`MASTER ${meta.name}`} />
            )))}
          </div>
        </div>
        <div className="flex min-h-0 gap-1">
          <div className="w-8"><VFader label="MASTER level" pos={editValue(MASTER_ROW, MASTER_LEVEL)} valueText={faderDb(editValue(MASTER_ROW, MASTER_LEVEL))} onPos={(p) => store.setParam(MASTER_ROW, MASTER_LEVEL, p)} /></div>
          <Meter label="MASTER L" peak={master.peakL} />
          <Meter label="MASTER R" peak={master.peakR} />
        </div>
      </div>
    </section>
  )
}
