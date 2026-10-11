import type { PointerEvent } from 'react'
import { modOutputOf } from '@/audio/snapshot'
import {
  FAVORITE_SHAPE_COUNT, MOD_DRAG_TYPE, MOD_KINDS, modLabel, NOISE_COLORS, previewShape, rateLabel, SHAPES, STEP_COUNT,
  SYNC_LABELS, TRIG_MODES,
} from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState, ModKind, ModulatorState } from '@/state/types'
import { Knob } from './Knob'

const W = 100
const H = 24
const toY = (v: number) => (1 - (v + 1) / 2) * (H - 2) + 1
const pathOf = (values: number[]) =>
  values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * W).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
const HZ_MIN = 0.01
const HZ_MAX = 40
const SYNC_LAST = SYNC_LABELS.length - 1
const hzOf = (v: number) => HZ_MIN * (HZ_MAX / HZ_MIN) ** v
const normOfHz = (hz: number) => Math.log(hz / HZ_MIN) / Math.log(HZ_MAX / HZ_MIN)
const formatHz = (hz: number) => `${hz < 10 ? hz.toFixed(2) : hz.toFixed(1)} Hz`
const select = 'rounded bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-acc'
const toggle = (on: boolean) =>
  `rounded border px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${on ? 'border-mod text-mod' : 'border-zinc-700 text-zinc-400'}`

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

export function ModStrip({ state, frame, store }: Props) {
  const slot = state.selectedMod
  const pick = (i: number) => {
    store.selectMod(i)
    if (state.modulators[i].kind === 0) store.updateModulator(i, { kind: 1 })
  }
  return (
    <section aria-label="Modulators" className="grid h-full min-h-0 grid-cols-[340px_1fr] gap-2 border-t border-zinc-800 p-2">
      <ModEditor slot={slot} m={state.modulators[slot]} tracks={state.tracks.map((t) => t.name)} store={store} />
      <div className="grid min-h-0 grid-cols-8 grid-rows-2 gap-1">
        {state.modulators.map((m, i) => {
          const off = m.kind === 0
          const targets = state.routes.filter((r) => r?.src === i).length
          const live = frame ? modOutputOf(frame, i) : 0
          const liveY = toY(m.bipolar ? live : live * 2 - 1)
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
                'relative flex min-w-0 flex-col justify-between rounded border px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                off ? 'cursor-pointer items-center justify-center border-dashed border-zinc-800 text-[9px] text-zinc-400'
                  : 'cursor-grab border-sky-950 bg-[#0a141a]',
                slot === i && !off ? 'ring-1 ring-mod' : '',
              ].join(' ')}>
              {off ? '+ add' : (
                <>
                  <div className="flex justify-between gap-1 text-[9px]">
                    <span className="truncate text-mod">{modLabel(i, m)}</span>
                    <span className="truncate text-sky-400">{rateLabel(m)}</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
                    <path d={pathOf(previewShape(m, 24))} fill="none" className="stroke-mod" strokeWidth={1.2} />
                    <line x1={0} x2={W} y1={liveY} y2={liveY} className="stroke-zinc-100/50" strokeWidth={0.8} />
                  </svg>
                  {targets > 0 && (
                    <span className="absolute right-1 bottom-0.5 rounded-full bg-mod px-1 text-[8px] text-black">{targets}</span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface EditorProps {
  slot: number
  m: ModulatorState
  tracks: string[]
  store: Store
}

function ModEditor({ slot, m, tracks, store }: EditorProps) {
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const timed = m.kind === 1 || m.kind === 3
  return (
    <div className="flex min-h-0 flex-col gap-1 overflow-y-auto rounded border border-mod/60 bg-[#0a141a] p-1.5 text-[10px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-mod">{modLabel(slot, m)}</span>
        <select aria-label="Modulator type" value={m.kind} className={select}
          onChange={(e) => update({ kind: Number(e.target.value) as ModKind })}>
          {MOD_KINDS.map((k, i) => <option key={k} value={i}>{k}</option>)}
        </select>
        {timed && (
          <>
            <button type="button" className={toggle(m.sync)} aria-pressed={m.sync} onClick={() => update({ sync: !m.sync })}>
              {m.sync ? 'SYNC' : 'HZ'}
            </button>
          </>
        )}
        {m.kind === 2 && (
          <select aria-label="Noise colour" value={m.color} className={select} onChange={(e) => update({ color: Number(e.target.value) })}>
            {NOISE_COLORS.map((c, i) => <option key={c} value={i}>{c}</option>)}
          </select>
        )}
        {m.kind !== 0 && (
          <button type="button" className={toggle(m.bipolar)} aria-pressed={m.bipolar} onClick={() => update({ bipolar: !m.bipolar })}>
            {m.bipolar ? 'BI' : 'UNI'}
          </button>
        )}
      </div>
      {m.kind === 1 && (
        <div role="group" aria-label="Shape" className="flex flex-wrap gap-1">
          {SHAPES.map((s, i) => (
            <button key={s.code} type="button" aria-pressed={m.shape === s.code} onClick={() => update({ shape: s.code })}
              className={[
                'rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                i === FAVORITE_SHAPE_COUNT ? 'ml-2' : '',
                m.shape === s.code ? 'bg-sky-950 text-mod' : i < FAVORITE_SHAPE_COUNT ? 'text-zinc-200' : 'text-zinc-400',
              ].join(' ')}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {m.kind === 3 && <StepBars m={m} onStep={(i, v) => store.setModStep(slot, i, v)} onLen={(len) => update({ stepLen: len })} />}
      {m.kind !== 0 && (
        <div className="flex items-end gap-1">
          {timed && (m.sync ? (
            <Knob label="RATE" value={m.rateIndex / SYNC_LAST} defaultValue={6 / SYNC_LAST}
              format={(v) => SYNC_LABELS[Math.round(v * SYNC_LAST)]} onChange={(v) => update({ rateIndex: Math.round(v * SYNC_LAST) })} />
          ) : (
            <Knob label="RATE" value={normOfHz(m.hz)} defaultValue={normOfHz(1)}
              format={(v) => formatHz(hzOf(v))} onChange={(v) => update({ hz: hzOf(v) })} />
          ))}
          {timed && <Knob label="PHASE" value={m.phase} defaultValue={0} onChange={(v) => update({ phase: v })} />}
          <Knob label="SMOOTH" value={m.smooth} defaultValue={0} onChange={(v) => update({ smooth: v })} />
          <Knob label="DEPTH" value={m.depth} defaultValue={1} onChange={(v) => update({ depth: v })} />
          {timed && (
            <div className="flex flex-col gap-1 pb-1">
              <select aria-label="Trigger mode" value={m.trigMode} className={select} onChange={(e) => update({ trigMode: Number(e.target.value) })}>
                {TRIG_MODES.map((t, i) => <option key={t} value={i}>{t}</option>)}
              </select>
              <select aria-label="Trigger source" value={m.trigSrc} className={select} onChange={(e) => update({ trigSrc: Number(e.target.value) })}>
                <option value={-1}>TRIG —</option>
                {tracks.map((t, i) => <option key={i} value={i}>{t}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
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
