import { useEffect, type PointerEvent } from 'react'
import { modOutputOf } from '@/audio/snapshot'
import {
  DEFAULT_RATE, MOD_DRAG_TYPE, MOD_KINDS, modLabel, NOISE_COLORS, previewShape, SHAPES, STEP_COUNT, SYNC_LABELS, TRIG_MODES,
} from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState, ModKind, ModulatorState } from '@/state/types'
import { Knob } from './Knob'
import { MacroFaders } from './MacroFaders'

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
const select = 'bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus-visible:ring-1 focus-visible:ring-zinc-100'
const segment = (on: boolean) =>
  `flex-1 px-1 py-0.5 lowercase outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100 ${on ? 'bg-zinc-100 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`

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
      <section aria-label="Modulators" className="grid min-h-0 grid-cols-2 gap-2 p-2">
        <ModPage slot={slot} m={state.modulators[slot]} mapping={mapping}
          tracks={state.tracks.map((t) => t.name)} store={store} />
        <div className="grid min-h-0 grid-cols-8 grid-rows-2 gap-px bg-zinc-800">
          {state.modulators.map((m, i) => {
            const off = m.kind === 0
            const targets = state.routes.filter((r) => r?.src === i).length
            const onHovered = hover !== null && state.routes.some((r) => r?.src === i && r.track === hover.row && r.param === hover.param)
            const v = live(i)
            return (
              <div key={i} role="button" tabIndex={0} draggable={!off} aria-pressed={slot === i}
                aria-label={off ? `Slot ${i + 1} empty` : `${modLabel(i, m)}, ${targets} targets`}
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
                    <span className="relative self-start truncate px-1 text-[9px] lowercase text-zinc-100">{modLabel(i, m)}</span>
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
    <Knob size="slot" label={label} steps={options.length} value={index / last} defaultValue={defaultIndex / last}
      format={(v) => options[at(v)]} onChange={(v) => { if (at(v) !== index) onIndex(at(v)) }} />
  )
}

function ModPage({ slot, m, mapping, tracks, store }: PageProps) {
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const timed = m.kind === 1 || m.kind === 3
  const shapeIndex = Math.max(0, SHAPES.findIndex((s) => s.code === m.shape))
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_5.5rem] gap-px bg-zinc-800 text-[10px]">
      <div className="flex min-h-0 flex-col gap-px bg-background p-1">
        <div className="flex gap-px">
          <div role="group" aria-label="Modulator type" className="flex flex-1 gap-px">
            {MOD_KINDS.map((k, i) => (
              <button key={k} type="button" aria-pressed={m.kind === i} className={segment(m.kind === i)} onClick={() => update({ kind: i as ModKind })}>{k}</button>
            ))}
          </div>
          {timed && <button type="button" className={segment(m.sync)} aria-pressed={m.sync} onClick={() => update({ sync: !m.sync })}>{m.sync ? 'SYNC' : 'HZ'}</button>}
          {m.kind !== 0 && <button type="button" className={segment(m.bipolar)} aria-pressed={m.bipolar} onClick={() => update({ bipolar: !m.bipolar })}>{m.bipolar ? 'BI' : 'UNI'}</button>}
        </div>
        {m.kind !== 0 && (
          <div className="grid grid-cols-2 gap-px">
            {timed && (m.sync ? (
              <ChoiceKnob label="RATE" options={SYNC_LABELS} index={m.rateIndex} defaultIndex={DEFAULT_RATE} onIndex={(i) => update({ rateIndex: i })} />
            ) : (
              <Knob size="slot" label="RATE" value={normOfHz(m.hz)} defaultValue={normOfHz(1)}
                format={(v) => formatHz(hzOf(v))} onChange={(v) => update({ hz: hzOf(v) })} />
            ))}
            {m.kind === 1 && (
              <ChoiceKnob label="SHAPE" options={SHAPES.map((x) => x.label)} index={shapeIndex} onIndex={(i) => update({ shape: SHAPES[i].code })} />
            )}
            {m.kind === 2 && <ChoiceKnob label="COLOR" options={NOISE_COLORS} index={m.color} onIndex={(i) => update({ color: i })} />}
            {timed && <Knob size="slot" label="PHASE" value={m.phase} defaultValue={0} format={(v) => `${Math.round(v * 360)}°`} onChange={(v) => update({ phase: v })} />}
            <Knob size="slot" label="SMOOTH" value={m.smooth} defaultValue={0} format={pct} onChange={(v) => update({ smooth: v })} />
            <Knob size="slot" label="DEPTH" value={m.depth} defaultValue={1} format={pct} onChange={(v) => update({ depth: v })} />
            {timed && (
              <>
                <ChoiceKnob label="MODE" options={TRIG_MODES} index={m.trigMode} onIndex={(i) => update({ trigMode: i })} />
                <ChoiceKnob label="TRIG" options={['—', ...tracks]} index={m.trigSrc + 1} onIndex={(i) => update({ trigSrc: i - 1 })} />
              </>
            )}
          </div>
        )}
        {m.kind === 3 && <StepBars m={m} onStep={(i, v) => store.setModStep(slot, i, v)} onLen={(len) => update({ stepLen: len })} />}
      </div>
      <button type="button" aria-label="MAP" aria-pressed={mapping} disabled={m.kind === 0} onClick={() => store.setMapping(!mapping)}
        className={`flex flex-col items-start justify-between p-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100 disabled:opacity-40 ${mapping ? 'bg-zinc-100 text-black' : 'bg-background text-zinc-100 hover:bg-zinc-900'}`}>
        <span className="lowercase">{modLabel(slot, m)}</span>
        <span className="text-lg leading-none font-bold">MAP</span>
      </button>
    </div>
  )
}

function StepBars({ m, onStep, onLen }: { m: ModulatorState; onStep(i: number, v: number): void; onLen(len: number): void }) {
  const fromPointer = (e: PointerEvent<HTMLDivElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect()
    onStep(i, Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2)))
  }
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Step values" className="flex h-10 flex-1 gap-px">
        {m.steps.map((v, i) => (
          <div key={i} role="slider" tabIndex={0} aria-label={`Step ${i + 1}`} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
            onPointerDown={(e) => fromPointer(e, i)}
            onPointerMove={(e) => { if (e.buttons) fromPointer(e, i) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') { e.preventDefault(); onStep(i, Math.min(1, v + 0.1)) }
              if (e.key === 'ArrowDown') { e.preventDefault(); onStep(i, Math.max(-1, v - 0.1)) }
            }}
            className={`relative flex-1 rounded-sm bg-zinc-900 outline-none focus-visible:ring-1 focus-visible:ring-acc ${i >= m.stepLen ? 'opacity-30' : ''}`}>
            <div className="absolute right-0 left-0 bg-mod/70"
              style={v >= 0 ? { bottom: '50%', height: `${v * 50}%` } : { top: '50%', height: `${-v * 50}%` }} />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-1 text-zinc-400">
        LEN
        <select value={m.stepLen} className={select} onChange={(e) => onLen(Number(e.target.value))}>
          {Array.from({ length: STEP_COUNT }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
      </label>
    </div>
  )
}
