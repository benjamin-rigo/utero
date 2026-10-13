// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE, SHAPES } from '@/state/modulation'
import { createStore, type Store } from '@/state/store'
import { ModStrip } from './ModStrip'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <ModStrip state={state} frame={null} store={store} />
}

function setup() {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('shows 16 tiles with the default bank', () => {
  setup()
  expect(screen.getByRole('button', { name: /^LFO1/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^NOISE4/ })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /empty$/ })).toHaveLength(12)
})

test('clicking an empty tile creates an LFO and selects it', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Slot 5 empty' }))
  expect(store.getState().selectedMod).toBe(4)
  expect(store.getState().modulators[4].kind).toBe(1)
})

test('the waveform is a knob over the shapes', () => {
  const store = setup()
  const wave = () => screen.getByRole('slider', { name: 'WAVE' })
  fireEvent.keyDown(wave(), { key: 'ArrowRight' })
  expect(store.getState().modulators[0].shape).toBe(SHAPES[1].code)
  expect(wave().getAttribute('aria-valuetext')).toBe(SHAPES[1].label)
})

test('the type knob has no STEP', () => {
  const store = setup()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Modulator type' }), { key: 'End' })
  expect(store.getState().modulators[0].kind).toBe(4)
  expect(screen.getByRole('slider', { name: 'Modulator type' }).getAttribute('aria-valuetext')).toBe('ENV')
})

test('a click selects a tile, a second click toggles map mode, Escape or OFF leaves it', () => {
  const store = setup()
  const tile = () => screen.getByRole('button', { name: /^LFO2/ })
  fireEvent.click(tile())
  expect([store.getState().selectedMod, store.getState().mapping]).toEqual([1, false])
  fireEvent.click(tile())
  expect(store.getState().mapping).toBe(true)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(store.getState().mapping).toBe(false)
  fireEvent.click(tile())
  expect(store.getState().mapping).toBe(true)
  expect(tile().getAttribute('aria-label')).toMatch(/mapping$/)
  expect(screen.queryByRole('button', { name: 'MAP' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Modulator type' }), { key: 'Home' })
  expect(store.getState().mapping).toBe(false)
})

test('RATE steps one sync division per arrow press', () => {
  const store = setup()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'RATE' }), { key: 'ArrowRight' })
  expect(store.getState().modulators[0].rateIndex).toBe(17)
})

test('the RATE knob steps through the sync list, or sweeps Hz', () => {
  const store = setup()
  const rate = () => screen.getByRole('slider', { name: 'RATE' })
  expect(rate().getAttribute('aria-valuetext')).toBe('4 BAR')
  fireEvent.keyDown(rate(), { key: 'End' })
  expect(store.getState().modulators[0].rateIndex).toBe(19)
  expect(rate().getAttribute('aria-valuetext')).toBe('32 BAR')
  fireEvent.keyDown(rate(), { key: 'Enter' })
  expect(rate().getAttribute('aria-valuetext')).toBe('1.00 Hz')
  fireEvent.keyDown(rate(), { key: 'End' })
  expect(store.getState().modulators[0].hz).toBeCloseTo(40)
})

test('dragging a tile carries its slot', () => {
  setup()
  const data: Record<string, string> = {}
  const dataTransfer = { setData: (t: string, v: string) => { data[t] = v }, effectAllowed: '' }
  fireEvent.dragStart(screen.getByRole('button', { name: /^LFO2/ }), { dataTransfer })
  expect(data[MOD_DRAG_TYPE]).toBe('1')
})

test('target count badge follows routes', () => {
  const store = setup()
  act(() => { store.addRoute(0, 0, 3) })
  act(() => { store.addRoute(0, 0, 4) })
  expect(screen.getByRole('button', { name: 'LFO1, 2 targets' })).toBeTruthy()
})

test('the selected modulator lists its targets, each removable', () => {
  const store = setup()
  act(() => { store.addRoute(0, 0, 4, 0.4) })
  expect(screen.getByLabelText('LFO1 targets').textContent).toContain('+40')
  fireEvent.click(screen.getByRole('button', { name: 'Remove kick.click route' }))
  expect(store.getState().routes.every((r) => r === null)).toBe(true)
})

test('a tap on rate toggles sync / Hz, on depth bipolar / unipolar', () => {
  const store = setup()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'RATE' }), { key: 'Enter' })
  expect(store.getState().modulators[0].sync).toBe(false)
  const depth = () => screen.getByRole('slider', { name: 'DEPTH' })
  expect(depth().getAttribute('aria-valuetext')).toBe('100% bi')
  fireEvent.keyDown(depth(), { key: 'Enter' })
  expect(store.getState().modulators[0].bipolar).toBe(false)
  expect(depth().getAttribute('aria-valuetext')).toBe('100% uni')
})
