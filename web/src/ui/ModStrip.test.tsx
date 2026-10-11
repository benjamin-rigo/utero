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

test('shape buttons edit the selected modulator', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'GLIDE' }))
  expect(store.getState().modulators[0].shape).toBe(1)
})

test('rate select uses the sync list', () => {
  const store = setup()
  fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '9' } })
  expect(store.getState().modulators[0].rateIndex).toBe(9)
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
