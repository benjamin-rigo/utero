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
import { envMeta, ENV_NAMES, ENV_SHOWN, formatParam, paramLabel } from '@/state/machines'
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
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] border-t border-zinc-800">
      <section aria-label="Modulators" className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)] gap-2 p-2">
        <ModPage slot={slot} m={state.modulators[slot]} mapping={mapping} routes={state.routes}
          tracks={state.tracks.map((t) => t.name)} store={store} />
        <div className="grid min-h-0 grid-cols-4 grid-rows-4 gap-px bg-zinc-800 2xl:grid-cols-8 2xl:grid-rows-2">
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
                  'relative flex min-h-0 min-w-0 overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100',
                  off ? 'cursor-pointer items-center justify-center bg-background text-[9px] text-zinc-400 hover:text-zinc-200'
                    : slot === i ? 'cursor-grab bg-zinc-700' : onHovered ? 'cursor-grab bg-zinc-800' : 'cursor-grab bg-zinc-900',
                  slot === i && mapping ? 'ring-1 ring-inset ring-zinc-100' : '',
                ].join(' ')}>
                {off ? '+' : (
                  <>
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                      <path d={pathOf(previewShape(m, 24))} fill="none" className="stroke-zinc-300" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                      <line x1={0} x2={W} y1={toY(m.bipolar ? v : v * 2 - 1)} y2={toY(m.bipolar ? v : v * 2 - 1)}
                        className="stroke-zinc-100/50" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    </svg>
                    <span className="relative self-start truncate bg-zinc-950/80 px-1 text-[9px] lowercase text-zinc-100">{modLabel(i, m)}{slot === i && mapping ? ' · map' : ''}</span>
                    {targets > 0 && (
                      <span className="absolute top-0.5 right-1 text-[9px] tabular-nums text-zinc-400">{targets}</span>
                    )}
                  </>
                )}
              </div>
            )
          })}
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
    <Knob label={label} steps={options.length} value={index / last} defaultValue={defaultIndex / last}
      format={(v) => options[at(v)]} onChange={(v) => { if (at(v) !== index) onIndex(at(v)) }} />
  )
}

/** A knob with its own either/or choice directly under it (rate + sync|hz, depth + bi|uni, trig + mode). */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-1">{children}</div>
}

/** Modulator types offered in the UI (STEP stays in the engine but is not offered). */
const KIND_CODES: ModKind[] = [0, 1, 2, 4]

const Divider = () => <div aria-hidden="true" className="w-px self-stretch bg-zinc-800" />

function ModPage({ slot, m, tracks, routes, store }: PageProps) {
  const targets = routes.flatMap((r, i) => (r && r.src === slot ? [{ r, i }] : []))
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const timed = m.kind === 1
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <div className="flex w-fit min-h-0 min-w-0 flex-col gap-2 overflow-hidden p-1 text-[10px]">
      <Segmented label="Modulator type" options={KIND_CODES.map((k) => MOD_KINDS[k])} index={Math.max(0, KIND_CODES.indexOf(m.kind))}
        onIndex={(i) => update(KIND_CODES[i] === 4 ? { kind: 4, bipolar: false } : { kind: KIND_CODES[i] })} />
      {m.kind === 1 && (
        <div role="radiogroup" aria-label="Shape" className="flex w-fit gap-px">
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
              className={`h-6 w-9 px-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100 ${m.shape === sh.code ? 'bg-zinc-100' : 'bg-zinc-900 hover:bg-zinc-800'}`}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                <path d={pathOf(previewShape({ ...m, shape: sh.code }, 24))} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                  className={m.shape === sh.code ? 'stroke-black' : 'stroke-zinc-300'} />
              </svg>
            </button>
          ))}
        </div>
      )}
      {m.kind !== 0 && (
        <div className="flex min-h-0 items-start gap-3">
          {m.kind === 4 && (
            <>
              <div className="h-[72px] w-40 shrink-0">
                <EnvGraph values={m.env} onChange={(i, v) => store.setModEnv(slot, i, v)} />
              </div>
              {ENV_NAMES.slice(0, ENV_SHOWN).map((n, i) => (
                <Knob key={n} label={n} ariaLabel={`${modLabel(slot, m)} ${n}`} value={m.env[i]} defaultValue={DEFAULT_ENV[i]}
                  format={(v) => formatParam(envMeta(i, 0), v)} onChange={(v) => store.setModEnv(slot, i, v)} />
              ))}
              <Divider />
            </>
          )}
          {timed && (
            <Group>
              {m.sync ? (
                <ChoiceKnob label="RATE" options={SYNC_LABELS} index={m.rateIndex} defaultIndex={DEFAULT_RATE} onIndex={(i) => update({ rateIndex: i })} />
              ) : (
                <Knob label="RATE" value={normOfHz(m.hz)} defaultValue={normOfHz(1)} format={(v) => formatHz(hzOf(v))} onChange={(v) => update({ hz: hzOf(v) })} />
              )}
              <Segmented label="Rate mode" options={['SYNC', 'HZ']} index={m.sync ? 0 : 1} onIndex={(i) => update({ sync: i === 0 })} />
            </Group>
          )}
          {m.kind === 2 && (
            <Group>
              <div className="h-14" />
              <Segmented label="Noise colour" options={NOISE_COLORS} index={m.color} onIndex={(i) => update({ color: i })} />
            </Group>
          )}
          {timed && <Knob label="PHASE" value={m.phase} defaultValue={0} format={(v) => `${Math.round(v * 360)}°`} onChange={(v) => update({ phase: v })} />}
          <Divider />
          <Group>
            <Knob label="DEPTH" value={m.depth} defaultValue={1} format={pct} onChange={(v) => update({ depth: v })} />
            <Segmented label="Polarity" options={['BI', 'UNI']} index={m.bipolar ? 0 : 1} onIndex={(i) => update({ bipolar: i === 0 })} />
          </Group>
          <Knob label="SMOOTH" value={m.smooth} defaultValue={0} format={pct} onChange={(v) => update({ smooth: v })} />
          {(timed || m.kind === 4) && (
            <>
              <Divider />
              <Group>
                <ChoiceKnob label="TRIG" options={['—', ...tracks]} index={m.trigSrc + 1} onIndex={(i) => update({ trigSrc: i - 1 })} />
                {timed && <Segmented label="Trigger mode" options={TRIG_MODES} index={m.trigMode} onIndex={(i) => update({ trigMode: i })} />}
              </Group>
            </>
          )}
          {targets.length > 0 && (
            <>
              <Divider />
              <div aria-label={`${modLabel(slot, m)} targets`} className="flex max-w-64 min-w-0 flex-wrap content-start gap-px">
                {targets.map(({ r, i }) => {
                  const name = paramLabel(tracks, r.track, r.param).toLowerCase()
                  return (
                    <span key={i} className="flex items-center gap-1 bg-zinc-900 pl-1.5 lowercase">
                      <span className="text-zinc-300">{name}</span>
                      <span className="tabular-nums text-zinc-100">{r.amount > 0 ? '+' : ''}{Math.round(r.amount * 100)}</span>
                      <button type="button" aria-label={`Remove ${name} route`} onClick={() => store.removeRoute(i)}
                        className="px-1 text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-100">×</button>
                    </span>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
