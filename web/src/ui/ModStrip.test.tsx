// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
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

test('shapes are icon choices; arrows walk them', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('radio', { name: 'GLIDE' }))
  expect(store.getState().modulators[0].shape).toBe(1)
  fireEvent.keyDown(screen.getByRole('radio', { name: 'GLIDE' }), { key: 'ArrowRight' })
  expect(store.getState().modulators[0].shape).toBe(2)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('S&H')
})

test('the type choice has no STEP', () => {
  setup()
  expect(screen.getByRole('radiogroup', { name: 'Modulator type' }).textContent).toBe('OFFLFONOISEENV')
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
  fireEvent.click(screen.getByRole('radio', { name: 'OFF' }))
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
  fireEvent.click(screen.getByRole('radio', { name: 'HZ' }))
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

test('rate mode and polarity are explicit choices', () => {
  const store = setup()
  expect(screen.getByRole('radiogroup', { name: 'Rate mode' }).querySelector('[aria-checked="true"]')?.textContent).toBe('SYNC')
  fireEvent.click(screen.getByRole('radio', { name: 'UNI' }))
  expect(store.getState().modulators[0].bipolar).toBe(false)
})
