import { describe, expect, test } from 'vitest'
import { Op } from '@/audio/ops'
import { createStore } from './store'

function connected() {
  const store = createStore()
  const sent: number[][] = []
  store.connect((c) => sent.push(c))
  sent.length = 0
  return { store, sent }
}

describe('store', () => {
  test('initial state has 12 tracks and a four-on-the-floor kick', () => {
    const s = createStore().getState()
    expect(s.tracks.map((t) => t.name)).toEqual(['KICK', 'KCK2', 'HH', 'OH', 'SNR', 'NOIS', 'SMPL', 'BASS', 'LD1', 'LD2', 'PAD', 'ORN'])
    expect(s.tracks[0].steps.flatMap((st, i) => (st.trig ? [i] : []))).toEqual([0, 4, 8, 12])
  })

  test('connect syncs bpm, lengths, speeds, non-default steps and kick params', () => {
    const store = createStore()
    const sent: number[][] = []
    store.connect((c) => sent.push(c))
    const count = (op: number) => sent.filter((c) => c[0] === op).length
    expect(count(Op.SetBpm)).toBe(1)
    expect(count(Op.SetLength)).toBe(12)
    expect(count(Op.SetSpeed)).toBe(12)
    expect(count(Op.SetStep)).toBe(4)
    expect(count(Op.SetParam)).toBe(155)
    expect(count(Op.SetFxOrder)).toBe(3)
  })

  test('toggleStep flips the step and sends it', () => {
    const { store, sent } = connected()
    store.toggleStep(1, 3)
    expect(store.getState().tracks[1].steps[3].trig).toBe(true)
    expect(sent).toEqual([[Op.SetStep, 1, 3, 1, 1, 100, 0, 1, 2, 0, 29]])
  })

  test('setLength rounds and clamps to 1..64', () => {
    const { store, sent } = connected()
    store.setLength(0, 0)
    expect(store.getState().tracks[0].length).toBe(1)
    store.setLength(0, 100)
    expect(store.getState().tracks[0].length).toBe(64)
    store.setLength(0, 5.6)
    expect(store.getState().tracks[0].length).toBe(6)
    expect(sent.at(-1)).toEqual([Op.SetLength, 0, 6])
  })

  test('setBpm clamps and ignores NaN', () => {
    const { store, sent } = connected()
    store.setBpm(Number.NaN)
    expect(store.getState().bpm).toBe(128)
    expect(sent).toEqual([])
    store.setBpm(1000)
    expect(store.getState().bpm).toBe(300)
    store.setBpm(5)
    expect(store.getState().bpm).toBe(20)
  })

  test('setParam clamps to 0..1', () => {
    const { store, sent } = connected()
    store.setParam(0, 2, 1.7)
    expect(store.getState().tracks[0].params[2]).toBe(1)
    expect(sent).toEqual([[Op.SetParam, 0, 2, 1]])
  })

  test('play and stop update state and send commands', () => {
    const { store, sent } = connected()
    store.play()
    expect(store.getState().playing).toBe(true)
    store.stop()
    expect(store.getState().playing).toBe(false)
    expect(sent).toEqual([[Op.Play], [Op.Stop]])
  })

  test('actions before connect only change state', () => {
    const store = createStore()
    store.toggleStep(0, 1)
    expect(store.getState().tracks[0].steps[1].trig).toBe(true)
  })

  test('subscribers are notified and can unsubscribe', () => {
    const store = createStore()
    let n = 0
    const off = store.subscribe(() => n++)
    store.select(3)
    off()
    store.select(4)
    expect(n).toBe(1)
    expect(store.getState().selected).toBe(4)
  })
})
