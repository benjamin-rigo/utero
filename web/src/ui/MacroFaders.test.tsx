// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

test('F2 on the name button starts a rename from the keyboard', () => {
  const store = setup()
  const btn = screen.getByRole('button', { name: 'M2' })
  expect(btn.getAttribute('aria-keyshortcuts')).toBe('F2')
  fireEvent.keyDown(btn, { key: 'F2' })
  const input = screen.getByLabelText('Rename M2')
  fireEvent.change(input, { target: { value: 'DIRT' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(store.getState().macros[1].name).toBe('DIRT')
})

test('target chips remove a macro target', () => {
  const store = setup()
  act(() => {
    store.armLearn(0, 'a')
    store.setParam(0, 1, 0.3)
    store.setParam(0, 3, 0.4)
  })
  expect(store.getState().macros[0].targets).toHaveLength(2)
  const chips = screen.getAllByRole('button', { name: /^Remove .* from M1$/ })
  expect(chips).toHaveLength(2)
  fireEvent.click(chips[0])
  expect(store.getState().macros[0].targets).toHaveLength(1)
})

test('armed learn button keeps full opacity text with a ring', () => {
  const store = setup()
  act(() => { store.armLearn(0, 'a') })
  const cls = screen.getByRole('button', { name: 'Learn M1 A' }).className
  expect(cls).toContain('bg-red-600')
  expect(cls).not.toContain('animate-pulse')
})
