import { describe, expect, test } from 'vitest'
import { Op } from '@/audio/ops'
import { createStore, effectiveValue } from './store'

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

describe('mixer state', () => {
  test('initial buses and master', () => {
    const s = createStore().getState()
    expect(s.buses.map((b) => b.name)).toEqual(['KICK', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ORN', 'FX'])
    expect(s.buses.every((b) => b.params.length === 3 && !b.muted)).toBe(true)
    expect(s.master.params).toHaveLength(11)
    expect(s.tracks[7].params).toHaveLength(9)
    expect(s.tracks[8].name).toBe('LD1')
    expect([s.muteQuantize, s.editMode]).toEqual([true, 'trig'])
  })

  test('connect sends machine, bus and master params plus bus mutes', () => {
    const { sent } = connected()
    expect(sent.filter((c) => c[0] === Op.SetParam)).toHaveLength(8 * 2 + 9 + 8 * 3 + 11)
    expect(sent.filter((c) => c[0] === Op.SetBusMute)).toHaveLength(8)
  })

  test('setParam on a bus row updates that bus', () => {
    const { store, sent } = fresh()
    store.setParam(15, 0, 0.2)
    expect(store.getState().buses[3].params[0]).toBe(0.2)
    expect(sent).toEqual([[Op.SetParam, 15, 0, 0.2]])
  })

  test('setParam outside a row table is ignored', () => {
    const { store, sent } = fresh()
    store.setParam(5, 0, 0.2)
    store.setParam(12, 7, 0.2)
    expect(sent).toEqual([])
  })

  test('learn on the master row uses the master base', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.setParam(20, 10, 0.3)
    expect(store.getState().macros[0].targets[0]).toEqual({ track: 20, param: 10, a: 0.3, b: 0.8, slot: 0 })
    expect(store.getState().master.params[10]).toBe(0.8)
  })

  test('effectiveValue reads bus rows', () => {
    const { store } = fresh()
    store.setParam(12, 2, 0.6)
    expect(effectiveValue(store.getState(), 12, 2)).toBe(0.6)
  })

  test('toggleMute sends the quantize flag only while playing', () => {
    const { store, sent } = fresh()
    store.toggleMute(0)
    store.play()
    store.toggleMute(0)
    store.setMuteQuantize(false)
    store.toggleMute(1)
    expect(sent.filter((c) => c[0] === Op.SetBusMute)).toEqual([[Op.SetBusMute, 0, 1, 0], [Op.SetBusMute, 0, 0, 1], [Op.SetBusMute, 1, 1, 0]])
    expect(store.getState().buses.map((b) => b.muted).slice(0, 2)).toEqual([false, true])
  })

  test('setStepNote clamps and ignores non-melodic tracks', () => {
    const { store, sent } = fresh()
    store.setStepNote(7, 0, 200)
    expect(store.getState().tracks[7].steps[0].note).toBe(127)
    store.setStepNote(0, 0, 50)
    expect(store.getState().tracks[0].steps[0].note).toBe(29)
    expect(sent).toHaveLength(1)
  })

  test('edit mode switches', () => {
    const { store } = fresh()
    store.setEditMode('note')
    expect(store.getState().editMode).toBe('note')
  })
})
