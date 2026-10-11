// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { KICK_PARAMS } from '@/state/kickParams'
import { createStore, type Store } from '@/state/store'
import { MachinePanel } from './MachinePanel'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <MachinePanel state={state} frame={null} store={store} />
}

const setup = () => {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('map mode: knobs edit the selected modulator amount, double-click clears it', () => {
  const store = setup()
  act(() => { store.selectMod(1); store.setMapping(true) })
  const decay = screen.getByRole('slider', { name: 'DECAY' })
  fireEvent.keyDown(decay, { key: 'ArrowUp' })
  fireEvent.keyDown(decay, { key: 'ArrowUp' })
  expect(store.getState().routes.find((r) => r)).toMatchObject({ src: 1, track: 0, param: 3 })
  expect(store.getState().routes.find((r) => r)?.amount).toBeCloseTo(0.02)
  expect(decay.getAttribute('aria-valuetext')).toBe('LFO2 amount +2')
  expect(store.getState().tracks[0].params[3]).toBe(KICK_PARAMS[3].default)
  fireEvent.doubleClick(decay)
  expect(store.getState().routes.every((r) => r === null)).toBe(true)
})

test('the selected knob lists its routes as chips that can be removed', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  act(() => { store.addRoute(1, 0, 3, 0.4) })
  expect(screen.getByText('+40')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove LFO2 route' }))
  expect(store.getState().routes.every((r) => r === null)).toBe(true)
})

test('dropping a tile on a knob routes it to that parameter', () => {
  const store = setup()
  const dataTransfer = { types: [MOD_DRAG_TYPE], getData: () => '2' }
  fireEvent.drop(screen.getByRole('slider', { name: 'TUNE' }), { dataTransfer })
  expect(store.getState().routes[0]).toMatchObject({ src: 2, track: 0, param: 0 })
})

test('while learning, knobs edit the macro endpoint', () => {
  const store = setup()
  act(() => { store.armLearn(0, 'b') })
  fireEvent.keyDown(screen.getByRole('slider', { name: 'NOISE' }), { key: 'End' })
  expect(store.getState().macros[0].targets[0]).toMatchObject({ track: 0, param: 5, b: 1 })
  expect(store.getState().tracks[0].params[5]).toBe(0.05)
})

test('tracks without a machine say so', () => {
  const store = setup()
  act(() => { store.select(4) })
  expect(screen.getByText(/nincs még machine/)).toBeTruthy()
})


test('a route from a switched-off modulator is labelled (off), not "+ add"', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  act(() => { store.addRoute(3, 0, 3) })
  act(() => { store.updateModulator(3, { kind: 0 }) })
  expect(screen.getByRole('button', { name: 'Remove MOD4 (off) route' })).toBeTruthy()
})

test('BASS shows 8 knobs and a SUB OCT switch', () => {
  const store = setup()
  act(() => store.select(7))
  expect(screen.getByText('BASS', { selector: 'span' })).toBeTruthy()
  for (const n of ['SUB', 'CHAR', 'BRIGHT', 'PLUCK', 'GRIT', 'DECAY', 'FM', 'LEVEL']) expect(screen.getByRole('slider', { name: n })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'DECAY' }), { key: 'End' })
  expect(store.getState().tracks[7].params[5]).toBe(1)
  const group = screen.getByRole('radiogroup', { name: 'SUB OCT' })
  expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe('0')
  fireEvent.click(screen.getByRole('radio', { name: '−1' }))
  expect(store.getState().tracks[7].params[8]).toBe(1)
  fireEvent.keyDown(screen.getByRole('radio', { name: '−1' }), { key: 'ArrowLeft' })
  expect(store.getState().tracks[7].params[8]).toBe(0)
  expect(document.activeElement?.textContent).toBe('0')
  fireEvent.keyDown(screen.getByRole('radio', { name: '0' }), { key: 'End' })
  expect(store.getState().tracks[7].params[8]).toBe(1)
})
