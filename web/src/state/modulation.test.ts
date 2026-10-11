import { expect, test } from 'vitest'
import { defaultModulator, initialModulators, modLabel, previewShape, rateLabel, SHAPES } from './modulation'

test('defaults: 4 bar sync, bipolar, off', () => {
  const m = defaultModulator()
  expect([m.kind, m.sync, m.rateIndex, m.bipolar, m.depth]).toEqual([0, true, 16, true, 1])
})

test('initial bank has LFO SIN, GLIDE, S&H and pink NOISE', () => {
  const mods = initialModulators()
  expect(mods.slice(0, 4).map((m) => [m.kind, m.shape, m.color])).toEqual([[1, 0, 0], [1, 1, 0], [1, 2, 0], [2, 0, 1]])
  expect(mods.slice(4).every((m) => m.kind === 0)).toBe(true)
})

test('labels', () => {
  const mods = initialModulators()
  expect(modLabel(0, mods[0])).toBe('LFO1')
  expect(modLabel(3, mods[3])).toBe('NOISE4')
  expect(modLabel(9, mods[9])).toBe('+ add')
  expect(rateLabel(mods[0])).toBe('4 BAR')
  expect(rateLabel({ ...mods[0], sync: false, hz: 0.5 })).toBe('0.50 Hz')
  expect(rateLabel(mods[3])).toBe('PINK')
})

test('favourite shapes come first', () => {
  expect(SHAPES.slice(0, 3).map((s) => s.label)).toEqual(['SIN', 'GLIDE', 'S&H'])
})

test('previews stay within −1..1 for every shape and kind', () => {
  for (const s of SHAPES) {
    const v = previewShape({ ...defaultModulator(), kind: 1, shape: s.code }, 24)
    expect(v).toHaveLength(24)
    expect(v.every((x) => x >= -1 && x <= 1)).toBe(true)
  }
  expect(previewShape({ ...defaultModulator(), kind: 3, steps: Array(16).fill(0.5), stepLen: 4 }, 10).every((x) => x === 0.5)).toBe(true)
})
