// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createStore, type Store } from '@/state/store'
import { MacroFaders } from './MacroFaders'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <MacroFaders state={state} store={store} />
}

const setup = () => {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('renders 8 vertical faders', () => {
  setup()
  expect(screen.getAllByRole('slider')).toHaveLength(8)
})

test('A and B buttons arm and disarm learn', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Learn M3 B' }))
  expect(store.getState().learn).toEqual({ macro: 2, side: 'b' })
  expect(screen.getByRole('button', { name: 'Learn M3 B' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Learn M3 B' }))
  expect(store.getState().learn).toBeNull()
})

test('keyboard moves a fader', () => {
  const store = setup()
  const fader = screen.getByRole('slider', { name: 'M1 macro' })
  fireEvent.keyDown(fader, { key: 'ArrowUp', shiftKey: true })
  expect(store.getState().macros[0].pos).toBeCloseTo(0.1)
  fireEvent.keyDown(fader, { key: 'End' })
  expect(store.getState().macros[0].pos).toBe(1)
})

test('double-click on the name renames the macro', () => {
  const store = setup()
  fireEvent.doubleClick(screen.getByRole('button', { name: 'M2' }))
  const input = screen.getByLabelText('Rename M2')
  fireEvent.change(input, { target: { value: 'DIRT' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(store.getState().macros[1].name).toBe('DIRT')
})

test('Escape cancels a rename', () => {
  const store = setup()
  fireEvent.doubleClick(screen.getByRole('button', { name: 'M2' }))
  const input = screen.getByLabelText('Rename M2')
  fireEvent.change(input, { target: { value: 'XX' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(store.getState().macros[1].name).toBe('M2')
})

test('a rename works after an earlier one was cancelled', () => {
  const store = setup()
  fireEvent.doubleClick(screen.getByRole('button', { name: 'M2' }))
  fireEvent.change(screen.getByLabelText('Rename M2'), { target: { value: 'XX' } })
  fireEvent.keyDown(screen.getByLabelText('Rename M2'), { key: 'Escape' })
  fireEvent.doubleClick(screen.getByRole('button', { name: 'M2' }))
  const input = screen.getByLabelText('Rename M2')
  fireEvent.change(input, { target: { value: 'DIRT' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(store.getState().macros[1].name).toBe('DIRT')
})
