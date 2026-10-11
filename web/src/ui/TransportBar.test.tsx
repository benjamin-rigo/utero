// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TransportBar } from './TransportBar'

afterEach(cleanup)

function setup(bpm = 128) {
  const onBpm = vi.fn()
  render(<TransportBar bpm={bpm} playing={false} starting={false} error={null} onTogglePlay={() => {}} onBpm={onBpm} />)
  const input = screen.getByLabelText('BPM') as HTMLInputElement
  return { onBpm, input }
}

test('typing does not change the tempo until Enter/blur', () => {
  const { onBpm, input } = setup()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '1' } })
  fireEvent.change(input, { target: { value: '14' } })
  fireEvent.change(input, { target: { value: '140' } })
  expect(onBpm).not.toHaveBeenCalled()
  fireEvent.blur(input)
  expect(onBpm).toHaveBeenCalledWith(140)
})

test('Escape cancels the typed value', () => {
  const { onBpm, input } = setup()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '90' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.blur(input)
  expect(onBpm).not.toHaveBeenCalled()
  expect(input.value).toBe('128')
})

test('an empty field restores the current tempo instead of jumping to 20', () => {
  const { onBpm, input } = setup()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)
  expect(onBpm).not.toHaveBeenCalled()
  expect(input.value).toBe('128')
})

test('arrow keys nudge the tempo live (shift = 1 BPM)', () => {
  const { onBpm, input } = setup(128)
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(onBpm).toHaveBeenLastCalledWith(128.1)
  fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true })
  expect(onBpm).toHaveBeenLastCalledWith(127)
})
