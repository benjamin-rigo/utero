// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createStore, type Store } from '@/state/store'
import { SequencerMatrix } from './SequencerMatrix'

afterEach(cleanup)

const IDLE = Array<number>(12).fill(-1)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return (
    <SequencerMatrix state={state} playheads={IDLE} onToggle={store.toggleStep} onSetLength={store.setLength}
      onSetSpeed={store.setSpeed} onSelect={store.select} onSetNote={store.setStepNote} />
  )
}

function setup() {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('clicking a step writes a trig and selects its row', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: /^BASS step 2,/ }))
  expect(store.getState().tracks[7].steps[1].trig).toBe(true)
  expect(store.getState().selected).toBe(7)
})

test('arrow keys move the note of a melodic trig right away', () => {
  const store = setup()
  act(() => store.toggleStep(7, 0))
  const step = screen.getByRole('button', { name: /^BASS step 1,/ })
  fireEvent.keyDown(step, { key: 'ArrowUp' })
  expect(store.getState().tracks[7].steps[0].note).toBe(30)
  fireEvent.keyDown(step, { key: 'ArrowUp', shiftKey: true })
  expect(store.getState().tracks[7].steps[0].note).toBe(42)
})

test('dragging up on an empty melodic step writes a trig and raises its note', () => {
  const store = setup()
  const step = screen.getByRole('button', { name: /^BASS step 3,/ })
  fireEvent.pointerDown(step, { clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(step, { clientY: 76, pointerId: 1 })
  fireEvent.pointerUp(step, { pointerId: 1 })
  fireEvent.click(step)
  expect(store.getState().tracks[7].steps[2]).toMatchObject({ trig: true, note: 32 })
})

test('arrows walk the grid on kick steps and off-trig steps', () => {
  setup()
  const kick = screen.getByRole('button', { name: 'KICK step 1' })
  kick.focus()
  fireEvent.keyDown(kick, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'KICK step 2' }))
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'KCK2 step 2' }))
})

test('trig steps show their note name', () => {
  const store = setup()
  act(() => store.toggleStep(7, 0))
  expect(screen.getByRole('button', { name: 'BASS step 1, F1' }).textContent).toBe('F1')
})

test('length: ⌥+click sets the end, the length slider takes arrows', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'KICK step 8' }), { altKey: true })
  expect(store.getState().tracks[0].length).toBe(8)
  expect(store.getState().tracks[0].steps[7].trig).toBe(false)
  fireEvent.keyDown(screen.getByRole('slider', { name: 'KICK length' }), { key: 'ArrowRight' })
  expect(store.getState().tracks[0].length).toBe(9)
})

test('the row rate knob walks the speeds in musical order', () => {
  const store = setup()
  const rate = screen.getByRole('slider', { name: 'KICK rate' })
  expect(rate.getAttribute('aria-valuetext')).toBe('1/16')
  fireEvent.keyDown(rate, { key: 'ArrowRight' })
  expect(store.getState().tracks[0].speed).toBe(6)
  fireEvent.keyDown(rate, { key: 'ArrowLeft' })
  fireEvent.keyDown(rate, { key: 'ArrowLeft' })
  expect(store.getState().tracks[0].speed).toBe(5)
})
