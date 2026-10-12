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
  const decay = screen.getByRole('slider', { name: 'CLICK' })
  fireEvent.keyDown(decay, { key: 'ArrowUp' })
  fireEvent.keyDown(decay, { key: 'ArrowUp' })
  expect(store.getState().routes.find((r) => r)).toMatchObject({ src: 1, track: 0, param: 4 })
  expect(store.getState().routes.find((r) => r)?.amount).toBeCloseTo(0.02)
  expect(decay.getAttribute('aria-valuetext')).toBe('LFO2 amount +2')
  expect(store.getState().tracks[0].params[4]).toBe(KICK_PARAMS[4].default)
  fireEvent.doubleClick(decay)
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
  expect(screen.getByText(/no machine/)).toBeTruthy()
})



test('BASS shows its 8 knobs and no switch row', () => {
  const store = setup()
  act(() => store.select(7))
  for (const n of ['SUB', 'CHAR', 'BRIGHT', 'PLUCK', 'GRIT', 'SUB OCT', 'FM', 'LEVEL']) expect(screen.getByRole('slider', { name: n })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'amp DEC' }), { key: 'End' })
  expect(store.getState().tracks[7].params[12]).toBe(1)
  fireEvent.keyDown(screen.getByRole('slider', { name: 'SUB OCT' }), { key: 'ArrowLeft' })
  expect(store.getState().tracks[7].params[8]).toBe(0.5)
})

test('the insert FX grid: filter click cycles its mode, delay double-click opens its settings', () => {
  const store = setup()
  const filter = screen.getByRole('slider', { name: 'filter' })
  fireEvent.pointerDown(filter, { clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(filter, { pointerId: 1 })
  expect(store.getState().tracks[0].params[15]).toBe(0.5)
  expect(screen.getByRole('button', { name: 'filter' }).textContent).toBe('hp')
  fireEvent.keyDown(filter, { key: 'Enter' })
  expect(store.getState().tracks[0].params[15]).toBe(1)
  fireEvent.doubleClick(filter)
  expect(store.getState().tracks[0].params[18]).toBe(0)
  fireEvent.doubleClick(screen.getByRole('slider', { name: 'delay' }))
  expect(screen.getByRole('region', { name: 'delay settings' })).toBeTruthy()
  expect(screen.getByRole('slider', { name: 'DLY TIME' }).getAttribute('aria-valuetext')).toBe('1/8D')
  fireEvent.click(screen.getByRole('button', { name: '‹ delay' }))
  expect(screen.getByRole('region', { name: 'Insert FX' })).toBeTruthy()
})

test('dropping an FX label onto another knob reorders the chain', () => {
  const store = setup()
  const data: Record<string, string> = {}
  const dataTransfer = { setData: (k: string, v: string) => { data[k] = v }, getData: (k: string) => data[k] ?? '', types: ['application/x-utero-fx'], effectAllowed: '' }
  fireEvent.dragStart(screen.getByRole('button', { name: 'reverb' }), { dataTransfer })
  // svg → Knob wrapper → FX cell (the drop target)
  fireEvent.drop(screen.getByRole('slider', { name: 'drive' }).parentElement!.parentElement!, { dataTransfer })
  expect(store.getState().tracks[0].fxOrder[0]).toBe(7)
})
