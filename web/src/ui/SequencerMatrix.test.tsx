// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createStore, type Store } from '@/state/store'
import { SequencerMatrix } from './SequencerMatrix'

afterEach(cleanup)

const IDLE = Array<number>(13).fill(-1)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return (
    <SequencerMatrix state={state} playheads={IDLE} onToggle={store.toggleStep} onSetLength={store.setLength}
      onSetSpeed={store.setSpeed} onSelect={store.select} onSetMode={store.setEditMode} onSetNote={store.setStepNote} />
  )
}

function setup() {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('the mode switch toggles between TRIG and NOTE', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'NOTE' }))
  expect(store.getState().editMode).toBe('note')
  expect(screen.getByRole('button', { name: 'NOTE' }).getAttribute('aria-pressed')).toBe('true')
})

test('arrow keys move a SUB step note in NOTE mode', () => {
  const store = setup()
  act(() => store.setEditMode('note'))
  const step = screen.getByRole('button', { name: /^SUB step 1,/ })
  fireEvent.keyDown(step, { key: 'ArrowUp' })
  expect(store.getState().tracks[7].steps[0].note).toBe(42)
  fireEvent.keyDown(step, { key: 'ArrowUp', shiftKey: true })
  expect(store.getState().tracks[7].steps[0].note).toBe(54)
})

test('clicking a step in NOTE mode does not toggle it', () => {
  const store = setup()
  act(() => store.setEditMode('note'))
  fireEvent.click(screen.getByRole('button', { name: /^SUB step 2,/ }))
  expect(store.getState().tracks[7].steps[1].trig).toBe(false)
})

test('kick steps ignore note edits', () => {
  const store = setup()
  act(() => store.setEditMode('note'))
  const kick = screen.getByRole('button', { name: 'KICK step 1' })
  expect(kick.getAttribute('aria-disabled')).toBe('true')
  fireEvent.keyDown(kick, { key: 'ArrowUp' })
  expect(store.getState().tracks[0].steps[0].note).toBe(41)
})

test('trig steps show their note name in NOTE mode', () => {
  const store = setup()
  act(() => store.toggleStep(7, 0))
  act(() => store.setEditMode('note'))
  expect(screen.getByRole('button', { name: 'SUB step 1, F2' }).textContent).toBe('F2')
})
