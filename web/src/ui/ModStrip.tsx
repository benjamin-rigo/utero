import { useEffect, type ReactNode } from 'react'
import { modOutputOf } from '@/audio/snapshot'
import {
  DEFAULT_ENV, DEFAULT_RATE, MOD_DRAG_TYPE, MOD_KINDS, modLabel, NOISE_COLORS, previewShape, SHAPES, SYNC_LABELS, TRIG_MODES,
} from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState, ModKind, ModulatorState } from '@/state/types'
import { Knob } from './Knob'
import { MacroFaders } from './MacroFaders'
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
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_var(--spacing-side)] border-t border-line">
      <section aria-label="Modulators" className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)] border-r border-line">
        <ModPage slot={slot} m={state.modulators[slot]} mapping={mapping} routes={state.routes}
          tracks={state.tracks.map((t) => t.name)} store={store} />
        <div className="min-h-0 p-inset">
          <div className="grid h-full min-h-0 grid-cols-4 grid-rows-4 gap-hair border border-line bg-line 2xl:grid-cols-8 2xl:grid-rows-2">
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
      <MacroFaders state={state} store={store} />
    </div>
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
}

/** A knob over a short list of named positions (shape, mode, trigger…). */
function ChoiceKnob({ label, options, index, defaultIndex = 0, onIndex }: ChoiceKnobProps) {
  const last = options.length - 1
  const at = (v: number) => Math.round(v * last)
  return (
    <Knob size="sm" label={label} steps={options.length} value={index / last} defaultValue={defaultIndex / last}
      format={(v) => options[at(v)]} onChange={(v) => { if (at(v) !== index) onIndex(at(v)) }} />
  )
}

/** Modulator types offered in the UI (STEP stays in the engine but is not offered). */
const KIND_CODES: ModKind[] = [0, 1, 2, 4]

/** Fixed slot widths (never change between types): one knob, or two knobs wide for trig + its 3-way mode. */
const CELL = { knob: 'w-knob', pair: 'w-knob', trig: 'w-knob-2' } as const

function Cell({ col, knob, choice, w = 'knob' }: { col: string; knob?: ReactNode; choice?: ReactNode; w?: keyof typeof CELL }) {
  // the knob is centred in the free height, the choice row (reserved even when empty) is the shared bottom line
  return (
    <div className={`row-start-2 flex h-full min-h-0 flex-col items-center gap-hair ${col} ${CELL[w]}`}>
      <div className="flex min-h-0 flex-1 items-center justify-center">{knob}</div>
      <div className="flex h-control shrink-0 items-end">{choice}</div>
    </div>
  )
}

/** Group separator: spans both rows of the page. */
const Divider = ({ col }: { col: string }) => <div aria-hidden="true" className={`row-span-2 row-start-1 w-hair bg-line ${col}`} />

function ModPage({ slot, m, tracks, routes, store }: PageProps) {
  const targets = routes.flatMap((r, i) => (r && r.src === slot ? [{ r, i }] : []))
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const timed = m.kind === 1
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const envKnob = (i: number) => (
    <Knob size="sm" label={ENV_NAMES[i]} ariaLabel={`${modLabel(slot, m)} ${ENV_NAMES[i]}`} value={m.env[i]} defaultValue={DEFAULT_ENV[i]}
      format={(v) => formatParam(envMeta(i, 0), v)} onChange={(v) => store.setModEnv(slot, i, v)} />
  )
  return (
    <div className="mod-grid h-full min-h-0 overflow-hidden border-r border-line p-inset">
      {/* top row: the waveform / colour / curve slot over the generator knobs (fixed size for every type), the type over the output knobs */}
      <div className="col-span-3 col-start-1 row-start-1 flex h-control items-center">
        {m.kind === 1 && (
          <div role="radiogroup" aria-label="Shape" className="flex h-full w-full gap-hair">
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
                className={`h-full flex-1 px-tight focus-ring ${m.shape === sh.code ? 'bg-ink' : 'bg-well hover:bg-raised'}`}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                  <path d={pathOf(previewShape({ ...m, shape: sh.code }, 24))} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                    className={m.shape === sh.code ? 'stroke-on-ink' : 'stroke-ink-soft'} />
                </svg>
              </button>
            ))}
          </div>
        )}
        {m.kind === 2 && <Segmented label="Noise colour" options={NOISE_COLORS} index={m.color} onIndex={(i) => update({ color: i })} />}
        {m.kind === 4 && <EnvGraph values={m.env} onChange={(i, v) => store.setModEnv(slot, i, v)} />}
      </div>
      <Segmented label="Modulator type" options={KIND_CODES.map((k) => MOD_KINDS[k])} index={Math.max(0, KIND_CODES.indexOf(m.kind))}
        className="col-span-4 col-start-5 row-start-1"
        onIndex={(i) => update(KIND_CODES[i] === 4 ? { kind: 4, bipolar: false } : { kind: KIND_CODES[i] })} />
      {/* fixed knob slots: [rate|atk] [phase|hold] [—|dec] │ [depth + bi/uni] [smooth] │ [trig + mode]; unused slots stay empty.
          Knobs sit centred in the space above, every choice sits on one shared bottom line. */}
      <Cell col="col-start-1" w="pair"
        knob={m.kind === 1 ? (m.sync ? (
          <ChoiceKnob label="RATE" options={SYNC_LABELS} index={m.rateIndex} defaultIndex={DEFAULT_RATE} onIndex={(i) => update({ rateIndex: i })} />
        ) : (
          <Knob size="sm" label="RATE" value={normOfHz(m.hz)} defaultValue={normOfHz(1)} format={(v) => formatHz(hzOf(v))} onChange={(v) => update({ hz: hzOf(v) })} />
        )) : m.kind === 4 ? envKnob(0) : null}
        choice={m.kind === 1 && <Segmented label="Rate mode" options={['SYNC', 'HZ']} index={m.sync ? 0 : 1} onIndex={(i) => update({ sync: i === 0 })} />} />
      <Cell col="col-start-2" knob={m.kind === 1 ? <Knob size="sm" label="PHASE" value={m.phase} defaultValue={0} format={(v) => `${Math.round(v * 360)}°`} onChange={(v) => update({ phase: v })} />
        : m.kind === 4 ? envKnob(1) : null} />
      <Cell col="col-start-3" knob={m.kind === 4 ? envKnob(2) : null} />
      <Divider col="col-start-4" />
      <Cell col="col-start-5" w="pair"
        knob={m.kind !== 0 && <Knob size="sm" label="DEPTH" value={m.depth} defaultValue={1} format={pct} onChange={(v) => update({ depth: v })} />}
        choice={m.kind !== 0 && <Segmented label="Polarity" options={['BI', 'UNI']} index={m.bipolar ? 0 : 1} onIndex={(i) => update({ bipolar: i === 0 })} />} />
      <Cell col="col-start-6" knob={m.kind !== 0 && <Knob size="sm" label="SMOOTH" value={m.smooth} defaultValue={0} format={pct} onChange={(v) => update({ smooth: v })} />} />
      <Divider col="col-start-7" />
      <Cell col="col-start-8" w="trig"
        knob={(m.kind === 1 || m.kind === 4) && (
          <ChoiceKnob label="TRIG" options={['—', ...tracks]} index={m.trigSrc + 1} onIndex={(i) => update({ trigSrc: i - 1 })} />
        )}
        choice={m.kind === 1 && <Segmented label="Trigger mode" options={TRIG_MODES} index={m.trigMode} onIndex={(i) => update({ trigMode: i })} />} />
        {targets.length > 0 && (
          <>
            <Divider col="col-start-9" />
            <div aria-label={`${modLabel(slot, m)} targets`} className="col-start-10 row-span-2 row-start-1 flex max-w-wave min-w-0 flex-wrap content-start gap-hair">
              {targets.map(({ r, i }) => {
                const name = paramLabel(tracks, r.track, r.param).toLowerCase()
                return (
                  <span key={i} className="flex h-control items-center gap-tight bg-well pl-tight">
                    <span className="text-ink-soft">{name}</span>
                    <span className="tabular-nums text-ink">{r.amount > 0 ? '+' : ''}{Math.round(r.amount * 100)}</span>
                    <button type="button" aria-label={`Remove ${name} route`} onClick={() => store.removeRoute(i)}
                      className="h-full px-tight text-ink-mute hover:text-ink focus-ring">×</button>
                  </span>
                )
              })}
            </div>
          </>
        )}
    </div>
  )
}
