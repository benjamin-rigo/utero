import type { DragEvent } from 'react'
import { effectiveOf } from '@/audio/snapshot'
import type { ParamMeta } from '@/state/kickParams'
import { formatParam } from '@/state/machines'
import { modLabel } from '@/state/modulation'
import { effectiveValue, modAmountFor, routeIndexFor, rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { Knob } from './Knob'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
  row: number
  param: number
  meta: ParamMeta
  size?: 'md' | 'sm' | 'xs' | 'slot'
  bipolar?: boolean
  /** Visible label when it differs from the param name (e.g. 'eq' for TILT). */
  label?: string
  reduction?: number
  onTap?(): void
  onOpen?(): void
  onLabelDragStart?(e: DragEvent<HTMLButtonElement>): void
  ariaLabel?: string
  selected?: boolean
  onSelect?(): void
}

/** A knob bound to (row, param): edits the base or the armed macro endpoint, shows live value, takes modulators. */
export function ParamKnob({ state, frame, store, row, param: p, meta, size, bipolar, label, reduction, onTap, onOpen, onLabelDragStart, ariaLabel, selected, onSelect }: Props) {
  const learn = state.learn
  const marker = state.macros[state.selectedMacro].targets.find((x) => x.track === row && x.param === p)
  const learnTarget = learn ? state.macros[learn.macro].targets.find((x) => x.track === row && x.param === p) : undefined
  const base = rowParams(state, row)[p] ?? meta.default
  const value = learn ? (learnTarget ? learnTarget[learn.side] : base) : base
  const mapRoute = state.routes[routeIndexFor(state, state.selectedMod, row, p)]
  const mapAmount = mapRoute ? mapRoute.amount : 0
  const display = learn ? value : frame ? effectiveOf(frame, row, p) : effectiveValue(state, row, p)
  return (
    <Knob label={label ?? meta.name} steps={meta.display?.kind === 'choice' ? meta.display.options.length : undefined} reduction={reduction} onTap={onTap} onOpen={onOpen} onLabelDragStart={onLabelDragStart} format={(v) => formatParam(meta, v)} ariaLabel={ariaLabel} size={size} bipolar={bipolar} value={value} display={display} defaultValue={meta.default}
      modAmount={modAmountFor(state, row, p)} markers={marker ? { a: marker.a, b: marker.b } : null}
      learning={learn !== null} selected={selected}
      onChange={(v) => store.setParam(row, p, v)}
      onSelect={onSelect}
      onDropModulator={(slot) => { store.addRoute(slot, row, p); onSelect?.() }}
      map={state.mapping && !learn ? { label: modLabel(state.selectedMod, state.modulators[state.selectedMod]), amount: mapAmount } : null}
      onMap={(delta) => store.nudgeMapAmount(row, p, delta)}
      onMapClear={() => store.clearMapAmount(row, p)}
      onHover={(on) => store.setHover(on ? { row, param: p } : null)}
      onModAmount={(delta) => {
        let idx = routeIndexFor(state, state.selectedMod, row, p)
        if (idx === -1) idx = state.routes.findIndex((r) => r !== null && r.track === row && r.param === p)
        const r = state.routes[idx]
        if (r) store.setRouteAmount(idx, r.amount + delta)
      }} />
  )
}
