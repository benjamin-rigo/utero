import { useEffect, type ReactNode } from 'react'
import { modOutputOf } from '@/audio/snapshot'
import {
  DEFAULT_ENV, DEFAULT_RATE, MOD_DRAG_TYPE, MOD_KINDS, modLabel, NOISE_COLORS, previewShape, SHAPES, SYNC_LABELS, TRIG_MODES,
} from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState, ModKind, ModulatorState } from '@/state/types'
import { Knob } from './Knob'
import { Segmented } from './Segmented'
import { envMeta, ENV_NAMES, formatParam, paramLabel } from '@/state/machines'
import { EnvGraph } from './EnvGraph'

const W = 100
const H = 24
const toY = (v: number) => (1 - (v + 1) / 2) * (H - 2) + 1
const pathOf = (values: number[]) =>
  values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * W).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
const HZ_MIN = 0.01
const HZ_MAX = 40
const hzOf = (v: number) => HZ_MIN * (HZ_MAX / HZ_MIN) ** v
const normOfHz = (hz: number) => Math.log(hz / HZ_MIN) / Math.log(HZ_MAX / HZ_MIN)
const formatHz = (hz: number) => `${hz < 10 ? hz.toFixed(2) : hz.toFixed(1)} Hz`
/** Knob 0..1 → fade −1..1: centre off, left fades in, right fades out; length in LFO cycles (FADE_MAX_CYCLES × fade²). */
const fadeLabel = (v: number) => {
  const f = v * 2 - 1
  if (Math.abs(f) < 0.01) return 'off'
  const cycles = 16 * f * f
  return `${f < 0 ? 'in' : 'out'} ${cycles < 10 ? cycles.toFixed(1) : Math.round(cycles)}`
}

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

export function ModStrip({ state, frame, store }: Props) {
  const slot = state.selectedMod
  const { mapping, hover } = state
  useEffect(() => {
    if (!mapping) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.setMapping(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapping, store])
  // first click selects (edit on the MOD page); clicking the selected tile toggles map mode
  const pick = (i: number) => {
    if (i === slot && state.modulators[i].kind !== 0) {
      store.setMapping(!mapping)
      return
    }
    store.selectMod(i)
    if (mapping) store.setMapping(false)
    if (state.modulators[i].kind === 0) store.updateModulator(i, { kind: 1 })
  }
  const live = (i: number) => (frame ? modOutputOf(frame, i) : 0)
  return (
    // on the left unit's columns: the page over beats 1–2 (with the name column), the tiles over beats 3–4 and the rate column
    <section aria-label="Modulators" className="col-span-full grid min-h-0 grid-cols-subgrid border-t border-line">
        <ModPage slot={slot} m={state.modulators[slot]} mapping={mapping} routes={state.routes} live={live(slot)}
          tracks={state.tracks.map((t) => t.name)} store={store} />
        {/* the tiles fill their pane: the pane edges are the grid's outer lines */}
        <div className="col-[12/-1] min-h-0">
          <div className="grid h-full min-h-0 grid-cols-4 grid-rows-4 gap-hair bg-line 2xl:grid-cols-8 2xl:grid-rows-2">
          {state.modulators.map((m, i) => {
            const off = m.kind === 0
            const targets = state.routes.filter((r) => r?.src === i).length
            const onHovered = hover !== null && state.routes.some((r) => r?.src === i && r.track === hover.row && r.param === hover.param)
            const v = live(i)
            return (
              <div key={i} role="button" tabIndex={0} draggable={!off} aria-pressed={slot === i}
                aria-label={off ? `Slot ${i + 1} empty` : `${modLabel(i, m)}, ${targets} targets${slot === i && mapping ? ', mapping' : ''}`}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick(i)
                  }
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(MOD_DRAG_TYPE, String(i))
                  e.dataTransfer.effectAllowed = 'link'
                }}
                className={[
                  'relative flex min-h-0 min-w-0 overflow-hidden focus-ring',
                  off ? 'cursor-pointer items-center justify-center bg-background text-micro text-ink-mute hover:text-ink-soft'
                    : slot === i ? 'cursor-grab bg-strong' : onHovered ? 'cursor-grab bg-raised' : 'cursor-grab bg-well',
                  slot === i && mapping ? 'ring-1 ring-inset ring-ink' : '',
                ].join(' ')}>
                {off ? '+' : (
                  <>
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                      <path d={pathOf(previewShape(m, 24))} fill="none" className="stroke-ink-soft" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                      <line x1={0} x2={W} y1={toY(m.bipolar ? v : v * 2 - 1)} y2={toY(m.bipolar ? v : v * 2 - 1)}
                        className="stroke-ink/50" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    </svg>
                    <span className="relative self-start truncate bg-background/80 px-tight text-micro text-ink">{modLabel(i, m)}{slot === i && mapping ? ' · map' : ''}</span>
                    {targets > 0 && (
                      <span className="absolute top-0 right-0 px-tight text-micro tabular-nums text-ink-mute">{targets}</span>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        </div>
    </section>
  )
}

interface PageProps {
  slot: number
  m: ModulatorState
  routes: AppState['routes']
  mapping: boolean
  /** The modulator's current output, drawn as a level line in the display. */
  live: number
  tracks: string[]
  store: Store
}

interface ChoiceKnobProps {
  label: string
  options: string[]
  index: number
  defaultIndex?: number
  onIndex(i: number): void
  size?: 'sm' | 'slot'
}

/** A knob over a short list of named positions (shape, mode, trigger…). */
function ChoiceKnob({ label, options, index, defaultIndex = 0, onIndex, size = 'sm' }: ChoiceKnobProps) {
  const last = options.length - 1
  const at = (v: number) => Math.round(v * last)
  return (
    <Knob size={size} label={label} steps={options.length} value={index / last} defaultValue={defaultIndex / last}
      format={(v) => options[at(v)]} onChange={(v) => { if (at(v) !== index) onIndex(at(v)) }} />
  )
}

/** Modulator types offered in the UI (STEP stays in the engine but is not offered). */
const KIND_CODES: ModKind[] = [0, 1, 2, 4]

function Cell({ col, knob, choice }: { col: string; knob?: ReactNode; choice?: ReactNode }) {
  // the knob is centred in the free height, the choice row (reserved even when empty) is the shared bottom line
  return (
    <div className={`row-start-2 flex h-full min-h-0 flex-col items-center gap-hair ${col}`}>
      <div className="flex min-h-0 flex-1 items-center justify-center">{knob}</div>
      <div className="flex h-control shrink-0 items-end">{choice}</div>
    </div>
  )
}

function ModPage({ slot, m, tracks, routes, live, store }: PageProps) {
  const targets = routes.flatMap((r, i) => (r && r.src === slot ? [{ r, i }] : []))
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const name = modLabel(slot, m)
  const envSlot = (i: number) => (
    <Knob size="slot" label={ENV_NAMES[i]} ariaLabel={`${name} ${ENV_NAMES[i]}`} value={m.env[i]} defaultValue={DEFAULT_ENV[i]}
      format={(v) => formatParam(envMeta(i, 0), v)} onChange={(v) => store.setModEnv(slot, i, v)} />
  )
  const level = m.bipolar ? live : live * 2 - 1
  return (
    // Ableton LFO layout: waveform choice over a big display with its sliders under it; rate / depth / smooth knobs to the right,
    // trigger under them. Every type keeps the same slots; what a type doesn't have stays empty.
    <div className="mod-grid col-[1/12] h-full min-h-0 overflow-hidden border-r border-line p-inset">
      <div className="col-start-1 row-start-1 flex h-control items-center">
        {m.kind === 1 && (
          <div role="radiogroup" aria-label="Shape" className="flex h-full w-full border border-strong">
            {SHAPES.map((sh) => (
              <button key={sh.code} type="button" role="radio" aria-checked={m.shape === sh.code} aria-label={sh.label}
                tabIndex={m.shape === sh.code ? 0 : -1} onClick={() => update({ shape: sh.code })}
                onKeyDown={(e) => {
                  const i = SHAPES.findIndex((x) => x.code === m.shape)
                  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                  if (!d) return
                  e.preventDefault()
                  const next = SHAPES[(i + d + SHAPES.length) % SHAPES.length]
                  update({ shape: next.code })
                  ;(e.currentTarget.parentElement?.children[SHAPES.indexOf(next)] as HTMLElement | undefined)?.focus()
                }}
                className={`h-full flex-1 px-tight focus-ring ${sh.code === SHAPES[0].code ? '' : 'border-l border-strong'} ${m.shape === sh.code ? 'bg-ink' : 'hover:bg-raised'}`}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                  <path d={pathOf(previewShape({ ...m, shape: sh.code }, 24))} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                    className={m.shape === sh.code ? 'stroke-on-ink' : 'stroke-ink-soft'} />
                </svg>
              </button>
            ))}
          </div>
        )}
        {m.kind === 2 && <Segmented label="Noise colour" options={NOISE_COLORS} index={m.color} onIndex={(i) => update({ color: i })} />}
      </div>
      <Segmented label="Modulator type" options={KIND_CODES.map((k) => MOD_KINDS[k])} index={Math.max(0, KIND_CODES.indexOf(m.kind))}
        className="col-span-3 col-start-2 row-start-1"
        onIndex={(i) => update(KIND_CODES[i] === 4 ? { kind: 4, bipolar: false } : { kind: KIND_CODES[i] })} />

      <div className="col-start-1 row-start-2 min-h-0 bg-well">
        {m.kind === 4 ? <EnvGraph values={m.env} onChange={(i, v) => store.setModEnv(slot, i, v)} /> : m.kind !== 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
            <line x1={0} x2={W} y1={toY(0)} y2={toY(0)} className="stroke-raised" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={pathOf(previewShape(m, 128))} fill="none" className="stroke-ink-soft" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={W} y1={toY(level)} y2={toY(level)} className="stroke-ink/50" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <Cell col="col-start-2" knob={m.kind === 1 && (m.sync ? (
        <ChoiceKnob label="RATE" options={SYNC_LABELS} index={m.rateIndex} defaultIndex={DEFAULT_RATE} onIndex={(i) => update({ rateIndex: i })} />
      ) : (
        <Knob size="sm" label="RATE" value={normOfHz(m.hz)} defaultValue={normOfHz(1)} format={(v) => formatHz(hzOf(v))} onChange={(v) => update({ hz: hzOf(v) })} />
      ))}
        choice={m.kind === 1 && <Segmented label="Rate mode" options={['SYNC', 'HZ']} index={m.sync ? 0 : 1} onIndex={(i) => update({ sync: i === 0 })} />} />
      <Cell col="col-start-3"
        knob={m.kind !== 0 && <Knob size="sm" label="DEPTH" value={m.depth} defaultValue={1} format={pct} onChange={(v) => update({ depth: v })} />}
        choice={m.kind !== 0 && <Segmented label="Polarity" options={['BI', 'UNI']} index={m.bipolar ? 0 : 1} onIndex={(i) => update({ bipolar: i === 0 })} />} />
      <Cell col="col-start-4" knob={m.kind !== 0 && <Knob size="sm" label="SMOOTH" value={m.smooth} defaultValue={0} format={pct} onChange={(v) => update({ smooth: v })} />} />

      {/* sliders under the display: [phase|atk] [fade|hold] [jitter|dec] */}
      <div className="col-start-1 row-start-3 grid grid-cols-3 gap-hair">
        {m.kind === 1 ? (
          <>
            <Knob size="slot" label="PHASE" ariaLabel={`${name} PHASE`} value={m.phase} defaultValue={0} format={(v) => `${Math.round(v * 360)}°`} onChange={(v) => update({ phase: v })} />
            <Knob size="slot" bipolar label="FADE" ariaLabel={`${name} FADE`} value={(m.fade + 1) / 2} defaultValue={0.5} format={fadeLabel} onChange={(v) => update({ fade: v * 2 - 1 })} />
            <Knob size="slot" label="JITTER" ariaLabel={`${name} JITTER`} value={m.jitter} defaultValue={0} format={pct} onChange={(v) => update({ jitter: v })} />
          </>
        ) : m.kind === 4 ? (
          <>{envSlot(0)}{envSlot(1)}{envSlot(2)}</>
        ) : null}
      </div>
      {/* trigger under the knobs: source slider + mode (the mode's space is kept when a type has no mode) */}
      <div className="col-span-3 col-start-2 row-start-3 flex gap-tight">
        <div className="min-w-0 flex-1">
          {(m.kind === 1 || m.kind === 4) && (
            <ChoiceKnob size="slot" label="TRIG" options={['—', ...tracks]} index={m.trigSrc + 1} onIndex={(i) => update({ trigSrc: i - 1 })} />
          )}
        </div>
        <Segmented label="Trigger mode" options={TRIG_MODES} index={m.trigMode} onIndex={(i) => update({ trigMode: i })}
          className={m.kind === 1 ? '' : 'invisible'} />
      </div>

      {targets.length > 0 && (
        <div aria-label={`${name} targets`} className="col-start-5 row-span-3 row-start-1 ml-group flex max-w-wave min-w-0 flex-wrap content-start gap-hair">
          {targets.map(({ r, i }) => {
            const target = paramLabel(tracks, r.track, r.param).toLowerCase()
            return (
              <span key={i} className="flex h-control items-center gap-tight bg-well pl-tight">
                <span className="text-ink-soft">{target}</span>
                <span className="tabular-nums text-ink">{r.amount > 0 ? '+' : ''}{Math.round(r.amount * 100)}</span>
                <button type="button" aria-label={`Remove ${target} route`} onClick={() => store.removeRoute(i)}
                  className="h-full px-tight text-ink-mute hover:text-ink focus-ring">×</button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
