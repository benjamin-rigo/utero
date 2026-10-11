import { describe, expect, test } from 'vitest'
import { Op } from '@/audio/ops'
import { KICK_PARAMS } from './kickParams'
import { MAX_ROUTES } from './modulation'
import { createStore, effectiveValue, modAmountFor, routeIndexFor } from './store'

function connected() {
  const store = createStore()
  const sent: number[][] = []
  store.connect((c) => sent.push(c))
  return { store, sent }
}

const fresh = () => {
  const c = connected()
  c.sent.length = 0
  return c
}

describe('sync', () => {
  test('connect sends all 16 modulators and the 8 macro positions', () => {
    const { sent } = connected()
    expect(sent.filter((c) => c[0] === Op.SetModulator)).toHaveLength(16)
    expect(sent.filter((c) => c[0] === Op.SetMacroPos)).toHaveLength(8)
    expect(sent.filter((c) => c[0] === Op.SetRoute)).toHaveLength(0)
  })
})

describe('routes', () => {
  test('addRoute creates one route and sends it', () => {
    const { store, sent } = fresh()
    const i = store.addRoute(0, 0, 3)
    expect(i).toBe(0)
    expect(store.getState().routes[0]).toEqual({ src: 0, track: 0, param: 3, amount: 0.25 })
    expect(sent).toEqual([[Op.SetRoute, 0, 0, 0, 3, 0.25]])
  })

  test('the same source and target are not added twice', () => {
    const { store, sent } = fresh()
    store.addRoute(1, 0, 2)
    expect(store.addRoute(1, 0, 2)).toBe(0)
    expect(sent).toHaveLength(1)
  })

  test('addRoute returns −1 when all slots are used', () => {
    const { store } = fresh()
    // 64 unique (src, track, param) triples
    for (let i = 0; i < MAX_ROUTES; i++) store.addRoute(i % 16, Math.floor(i / 16) % 2, Math.floor(i / 32))
    expect(store.getState().routes.every(Boolean)).toBe(true)
    expect(store.addRoute(15, 1, 15)).toBe(-1)
  })

  test('setRouteAmount clamps to ±1 and removeRoute clears', () => {
    const { store, sent } = fresh()
    const i = store.addRoute(0, 0, 3)
    store.setRouteAmount(i, 4)
    expect(store.getState().routes[i]?.amount).toBe(1)
    store.removeRoute(i)
    expect(store.getState().routes[i]).toBeNull()
    expect(sent.slice(-2)).toEqual([[Op.SetRoute, i, 0, 0, 3, 1], [Op.ClearRoute, i]])
  })

  test('helpers sum amounts and find a route', () => {
    const { store } = fresh()
    store.addRoute(0, 0, 3, 0.25)
    store.addRoute(1, 0, 3, -0.5)
    expect(modAmountFor(store.getState(), 0, 3)).toBeCloseTo(-0.25)
    expect(routeIndexFor(store.getState(), 1, 0, 3)).toBe(1)
    expect(routeIndexFor(store.getState(), 2, 0, 3)).toBe(-1)
  })
})

describe('modulators', () => {
  test('updateModulator merges and sends the full settings', () => {
    const { store, sent } = fresh()
    store.updateModulator(5, { kind: 1, shape: 2, rateIndex: 3 })
    const m = store.getState().modulators[5]
    expect([m.kind, m.shape, m.rateIndex, m.bipolar]).toEqual([1, 2, 3, true])
    expect(sent).toEqual([[Op.SetModulator, 5, 1, 2, 0, 1, 3, 1, 0, 1, 0, -1, 0, 1]])
  })

  test('hz is clamped to 0.01–40 and non-finite hz is ignored', () => {
    const { store } = fresh()
    store.updateModulator(1, { kind: 1, hz: 500 })
    expect(store.getState().modulators[1].hz).toBe(40)
    store.updateModulator(1, { hz: 0 })
    expect(store.getState().modulators[1].hz).toBe(0.01)
    store.updateModulator(1, { hz: NaN })
    expect(store.getState().modulators[1].hz).toBe(0.01)
    store.updateModulator(1, { hz: Infinity })
    expect(store.getState().modulators[1].hz).toBe(0.01)
  })

  test('stepLen changes also send SetModStepLen; steps are clamped', () => {
    const { store, sent } = fresh()
    store.updateModulator(4, { kind: 3, stepLen: 8 })
    store.setModStep(4, 2, 3)
    expect(store.getState().modulators[4].steps[2]).toBe(1)
    expect(sent.map((c) => c[0])).toEqual([Op.SetModulator, Op.SetModStepLen, Op.SetModStep])
  })
})

describe('macros and learn', () => {
  test('arming selects the macro, jumps the fader and sends the position', () => {
    const { store, sent } = fresh()
    store.armLearn(2, 'b')
    expect(store.getState().learn).toEqual({ macro: 2, side: 'b' })
    expect(store.getState().selectedMacro).toBe(2)
    expect(store.getState().macros[2].pos).toBe(1)
    expect(sent).toEqual([[Op.SetMacroPos, 2, 1]])
  })

  test('arming the same side again disarms', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.armLearn(0, 'a')
    expect(store.getState().learn).toBeNull()
  })

  test('learn records endpoints without touching the base', () => {
    const { store, sent } = fresh()
    const base = store.getState().tracks[0].params[5]
    store.armLearn(0, 'a')
    store.setParam(0, 5, 0.1)
    store.armLearn(0, 'b')
    store.setParam(0, 5, 0.9)
    expect(store.getState().tracks[0].params[5]).toBe(base)
    expect(store.getState().macros[0].targets).toEqual([{ track: 0, param: 5, a: 0.1, b: 0.9 }])
    expect(sent.filter((c) => c[0] === Op.SetMacroTarget).at(-1)).toEqual([Op.SetMacroTarget, 0, 0, 0, 5, 0.1, 0.9])
    expect(sent.some((c) => c[0] === Op.SetParam)).toBe(false)
  })

  test('a new target starts with both ends at the base', () => {
    const { store } = fresh()
    const base = store.getState().tracks[1].params[0]
    store.armLearn(3, 'b')
    store.setParam(1, 0, 0.7)
    expect(store.getState().macros[3].targets[0]).toEqual({ track: 1, param: 0, a: base, b: 0.7 })
  })

  test('removeMacroTarget shifts later targets and resends them', () => {
    const { store, sent } = fresh()
    store.armLearn(0, 'a')
    store.setParam(0, 1, 0.1)
    store.setParam(0, 2, 0.2)
    store.setParam(0, 3, 0.3)
    sent.length = 0
    store.removeMacroTarget(0, 0)
    expect(store.getState().macros[0].targets.map((t) => t.param)).toEqual([2, 3])
    expect(sent.map((c) => [c[0], c[2]])).toEqual([[Op.SetMacroTarget, 0], [Op.SetMacroTarget, 1], [Op.ClearMacroTarget, 2]])
  })

  test('effectiveValue applies the macro interpolation', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.setParam(0, 0, 0.2)
    store.armLearn(0, 'b')
    store.setParam(0, 0, 0.6)
    store.armLearn(0, 'b') // disarm
    store.setMacroPos(0, 0.5)
    expect(effectiveValue(store.getState(), 0, 0)).toBeCloseTo(0.4)
    expect(effectiveValue(store.getState(), 0, 1)).toBe(KICK_PARAMS[1].default)
  })

  test('renameMacro trims and ignores empty names', () => {
    const { store } = fresh()
    store.renameMacro(1, '  DIRT ')
    store.renameMacro(1, '   ')
    expect(store.getState().macros[1].name).toBe('DIRT')
  })
})

describe('route slot allocation', () => {
  test('a freed route slot is not reused immediately', () => {
    const { store } = fresh()
    expect(store.addRoute(0, 0, 1)).toBe(0)
    expect(store.addRoute(1, 0, 1)).toBe(1)
    store.removeRoute(0)
    expect(store.addRoute(2, 0, 1)).toBe(2)
  })
})
