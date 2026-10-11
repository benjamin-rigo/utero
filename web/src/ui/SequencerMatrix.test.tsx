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

test('the first click selects the row, the next one writes the trig', () => {
  const store = setup()
  const step = () => screen.getByRole('button', { name: /^BASS step 2,/ })
  fireEvent.click(step())
  expect(store.getState().selected).toBe(7)
  expect(store.getState().tracks[7].steps[1].trig).toBe(false)
  fireEvent.click(step())
  expect(store.getState().tracks[7].steps[1].trig).toBe(true)
})

test('dragging in an unselected row does not write', () => {
  const store = setup()
  const step = screen.getByRole('button', { name: /^BASS step 3,/ })
  fireEvent.pointerDown(step, { clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(step, { clientY: 60, pointerId: 1 })
  fireEvent.pointerUp(step, { pointerId: 1 })
  fireEvent.click(step)
  expect(store.getState().tracks[7].steps[2].trig).toBe(false)
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
  act(() => store.select(7))
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

test('the length handle keeps dragging after the end step moves', () => {
  const store = setup()
  act(() => store.setLength(0, 8))
  const handle = document.querySelector('[data-track="0"] [data-length-handle]')!
  fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 })
  const section = screen.getByRole('region', { name: 'Sequencer' })
  // jsdom lays every cell at x = 0, so any x lands on the last visible step
  fireEvent.pointerMove(section, { clientX: 50, pointerId: 1 })
  expect(store.getState().tracks[0].length).toBe(16)
  fireEvent.pointerUp(section, { pointerId: 1 })
  fireEvent.pointerMove(section, { clientX: 0, pointerId: 1 })
  fireEvent.click(screen.getByRole('button', { name: 'KICK step 2' }))
  expect(store.getState().tracks[0].steps[1].trig).toBe(true)
})

test('kick rows show the tuner reading', () => {
  const store = createStore()
  render(<SequencerMatrix state={store.getState()} playheads={IDLE} onToggle={store.toggleStep} onSetLength={store.setLength}
    onSetSpeed={store.setSpeed} onSelect={store.select} onSetNote={store.setStepNote} tuner={['F1 -3', null]} />)
  expect(screen.getByRole('button', { name: 'KICK F1 -3' })).toBeTruthy()
})
