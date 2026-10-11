// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
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

test('a route can be added without drag and drop, then removed', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  fireEvent.change(screen.getByLabelText('Modulator to add'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: '+ route' }))
  expect(store.getState().routes[0]).toEqual({ src: 1, track: 0, param: 3, amount: 0.25 })
  fireEvent.change(screen.getByLabelText('LFO2 amount'), { target: { value: '-40' } })
  expect(store.getState().routes[0]?.amount).toBeCloseTo(-0.4)
  fireEvent.click(screen.getByRole('button', { name: 'Remove LFO2 route' }))
  expect(store.getState().routes[0]).toBeNull()
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
  fireEvent.keyDown(screen.getByRole('slider', { name: 'DRIVE' }), { key: 'End' })
  expect(store.getState().macros[0].targets[0]).toMatchObject({ track: 0, param: 5, b: 1 })
  expect(store.getState().tracks[0].params[5]).toBe(0.2)
})

test('tracks without a machine say so', () => {
  const store = setup()
  act(() => { store.select(4) })
  expect(screen.getByText(/nincs még machine/)).toBeTruthy()
})

test('add-route source falls back to the first active modulator', () => {
  const store = setup()
  act(() => { store.updateModulator(0, { kind: 0 }) })
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  fireEvent.click(screen.getByRole('button', { name: '+ route' }))
  expect(store.getState().routes[0]).toMatchObject({ src: 1, track: 0, param: 3 })
})
