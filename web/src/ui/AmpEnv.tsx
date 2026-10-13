import { ENV_BASE, ENV_NAMES, ENV_SHOWN, type MachineDef } from '@/state/machines'
import { rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { EnvGraph } from './EnvGraph'
import { ParamKnob } from './ParamKnob'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
  track: number
  machine: MachineDef
}

/** The machine's amp envelope: the curve to drag, plus a value slot per stage for precise/keyboard edits. */
export function AmpEnv({ state, frame, store, track: t, machine }: Props) {
  const params = ENV_NAMES.slice(0, ENV_SHOWN).map((_, i) => ENV_BASE + i)
  const row = rowParams(state, t)
  return (
    <section aria-label="Amp envelope" className="flex min-h-0 flex-1 flex-col gap-hair border-b border-line p-inset">
      <div className="min-h-graph flex-1">
        <EnvGraph values={params.map((p) => row[p] ?? machine.params[p].default)} onChange={(i, v) => store.setParam(t, ENV_BASE + i, v)} />
      </div>
      <div className="grid grid-cols-3 gap-hair">
        {params.map((p, i) => (
          <ParamKnob key={p} state={state} frame={frame} store={store} row={t} param={p} meta={machine.params[p]} size="slot"
            label={ENV_NAMES[i].toLowerCase()} ariaLabel={`amp ${ENV_NAMES[i]}`} />
        ))}
      </div>
    </section>
  )
}
