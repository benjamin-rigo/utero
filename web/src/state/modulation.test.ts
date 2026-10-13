import { expect, test } from 'vitest'
import { defaultModulator, initialModulators, modLabel, outputPreview, rateLabel, SHAPES, SYNC_LABELS } from './modulation'

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
    const v = outputPreview({ ...defaultModulator(), kind: 1, shape: s.code, jitter: 1 }, 128, 48)
    expect(v).toHaveLength(48)
    expect(v.every((x) => x >= -1 && x <= 1)).toBe(true)
  }
  for (const kind of [2, 4] as const) expect(outputPreview({ ...defaultModulator(), kind }, 128, 48).every((x) => x >= -1 && x <= 1)).toBe(true)
})

test('the preview follows depth, polarity, rate and smooth', () => {
  const lfo = { ...defaultModulator(), kind: 1 as const, shape: 0, sync: true, rateIndex: SYNC_LABELS.indexOf('1/4') }
  const peak = (v: number[]) => Math.max(...v.map(Math.abs))
  expect(peak(outputPreview({ ...lfo, depth: 0.5 }, 128, 96))).toBeCloseTo(0.5, 1)
  expect(Math.min(...outputPreview({ ...lfo, bipolar: false }, 128, 96))).toBeGreaterThanOrEqual(0)
  // 1/4 = four cycles per bar: four upward zero crossings
  const ups = (v: number[]) => v.filter((x, i) => i > 0 && v[i - 1] < 0 && x >= 0).length
  expect(ups(outputPreview(lfo, 128, 192))).toBe(3)
  expect(peak(outputPreview({ ...lfo, smooth: 1 }, 128, 96))).toBeLessThan(peak(outputPreview(lfo, 128, 96)))
})
