import { useEffect } from 'react'
import {
  DEFAULT_ENV, DEFAULT_RATE, MOD_DRAG_TYPE, MOD_KINDS, modLabel, NOISE_COLORS, outputPreview, SHAPES, SYNC_LABELS, TRIG_MODES,
} from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState, ModKind, ModulatorState } from '@/state/types'
import { EmptyKnob, Knob } from './Knob'
import { Segmented } from './Segmented'
import { envMeta, ENV_NAMES, formatParam, paramLabel } from '@/state/machines'

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
  return (
    // on the left unit's columns: the page over beats 1–2 (with the name column), the tiles over beats 3–4 and the rate column
    <section aria-label="Modulators" className="col-span-full grid min-h-0 grid-cols-subgrid border-t border-line">
        <ModPage slot={slot} m={state.modulators[slot]} mapping={mapping} routes={state.routes}
          tracks={state.tracks.map((t) => t.name)} store={store} />
        {/* the tiles fill their pane: the pane edges are the grid's outer lines */}
        <div className="col-[12/-1] min-h-0">
          <div className="grid h-full min-h-0 grid-cols-4 grid-rows-4 gap-hair bg-line 2xl:grid-cols-8 2xl:grid-rows-2">
          {state.modulators.map((m, i) => {
            const off = m.kind === 0
            const targets = state.routes.filter((r) => r?.src === i).length
            const onHovered = hover !== null && state.routes.some((r) => r?.src === i && r.track === hover.row && r.param === hover.param)
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
                      {/* the output over one bar as currently set; a still centre line for reference */}
                      <line x1={0} x2={W} y1={toY(0)} y2={toY(0)} className="stroke-raised" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <path d={pathOf(outputPreview(m, state.bpm, 96))} fill="none" className="stroke-ink-soft" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
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
  tracks: string[]
  store: Store
}

interface ChoiceKnobProps {
  label: string
  options: string[]
  index: number
  defaultIndex?: number
  onIndex(i: number): void
  ariaLabel?: string
  onTap?(): void
}

/** A knob over a short list of named positions (shape, mode, trigger…). */
function ChoiceKnob({ label, options, index, defaultIndex = 0, onIndex, ariaLabel, onTap }: ChoiceKnobProps) {
  const last = options.length - 1
  const at = (v: number) => Math.round(v * last)
  return (
    <Knob size="sm" label={label} ariaLabel={ariaLabel} onTap={onTap} steps={options.length} value={index / last} defaultValue={defaultIndex / last}
      format={(v) => options[at(v)]} onChange={(v) => { if (at(v) !== index) onIndex(at(v)) }} />
  )
}

/** Modulator types offered in the UI (STEP stays in the engine but is not offered). */
const KIND_CODES: ModKind[] = [0, 1, 2, 4]


/** Shapes, noise colours and trigger modes as knob positions (names as the engine codes them). */
const SHAPE_NAMES = SHAPES.map((sh) => sh.label)

/**
 * Two rows of four knobs, fixed for every type (a slot a type doesn't use stays empty):
 *   type · waveform|colour|atk · rate|hold · depth
 *   trig mode · trig · jitter|dec · smooth
 * A click (no drag) on rate toggles sync / Hz, on depth bipolar / unipolar.
 */
function ModPage({ slot, m, tracks, routes, store }: PageProps) {
  const targets = routes.flatMap((r, i) => (r && r.src === slot ? [{ r, i }] : []))
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const name = modLabel(slot, m)
  const lfo = m.kind === 1
  const env = m.kind === 4
  const envKnob = (i: number) => (
    <Knob size="sm" label={ENV_NAMES[i]} value={m.env[i]} defaultValue={DEFAULT_ENV[i]}
      format={(v) => formatParam(envMeta(i, 0), v)} onChange={(v) => store.setModEnv(slot, i, v)} />
  )
  const shapeIndex = Math.max(0, SHAPES.findIndex((sh) => sh.code === m.shape))
  const slots = [
    <ChoiceKnob key="type" label="TYPE" ariaLabel="Modulator type" options={KIND_CODES.map((k) => MOD_KINDS[k])} index={Math.max(0, KIND_CODES.indexOf(m.kind))}
      onIndex={(i) => update(KIND_CODES[i] === 4 ? { kind: 4, bipolar: false } : { kind: KIND_CODES[i] })} />,
    lfo ? <ChoiceKnob key="wave" label="WAVE" options={SHAPE_NAMES} index={shapeIndex} onIndex={(i) => update({ shape: SHAPES[i].code })} />
      : m.kind === 2 ? <ChoiceKnob key="wave" label="COLOUR" options={NOISE_COLORS} index={m.color} onIndex={(i) => update({ color: i })} />
      : env ? envKnob(0) : null,
    lfo ? (m.sync ? (
      <ChoiceKnob key="rate" label="RATE" options={SYNC_LABELS} index={m.rateIndex} defaultIndex={DEFAULT_RATE} onIndex={(i) => update({ rateIndex: i })} onTap={() => update({ sync: false })} />
    ) : (
      <Knob key="rate" size="sm" label="RATE" value={normOfHz(m.hz)} defaultValue={normOfHz(1)} format={(v) => formatHz(hzOf(v))} onChange={(v) => update({ hz: hzOf(v) })} onTap={() => update({ sync: true })} />
    )) : env ? envKnob(1) : null,
    m.kind !== 0 ? <Knob key="depth" size="sm" label="DEPTH" value={m.depth} defaultValue={1} format={(v) => `${pct(v)} ${m.bipolar ? 'bi' : 'uni'}`}
      onChange={(v) => update({ depth: v })} onTap={() => update({ bipolar: !m.bipolar })} /> : null,
    lfo ? <ChoiceKnob key="mode" label="MODE" ariaLabel="Trigger mode" options={TRIG_MODES} index={m.trigMode} onIndex={(i) => update({ trigMode: i })} /> : null,
    lfo || env ? <ChoiceKnob key="trig" label="TRIG" options={['—', ...tracks]} index={m.trigSrc + 1} onIndex={(i) => update({ trigSrc: i - 1 })} /> : null,
    lfo ? <Knob key="jitter" size="sm" label="JITTER" value={m.jitter} defaultValue={0} format={pct} onChange={(v) => update({ jitter: v })} />
      : env ? envKnob(2) : null,
    m.kind !== 0 ? <Knob key="smooth" size="sm" label="SMOOTH" value={m.smooth} defaultValue={0} format={pct} onChange={(v) => update({ smooth: v })} /> : null,
  ]
  return (
    <div className="col-[1/12] grid min-h-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden border-r border-line p-inset">
      <div className="knob-row content-center">
        {slots.map((k, i) => <div key={i} className="flex h-knob-cell w-knob items-center justify-center">{k ?? <EmptyKnob />}</div>)}
      </div>
      {targets.length > 0 && (
        <div aria-label={`${name} targets`} className="ml-group flex max-w-wave min-w-0 flex-wrap content-start gap-hair">
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
