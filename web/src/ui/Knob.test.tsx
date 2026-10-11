// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { Knob } from './Knob'

afterEach(cleanup)

function setup(extra: Partial<Parameters<typeof Knob>[0]> = {}) {
  const onChange = vi.fn()
  render(<Knob label="DECAY" value={0.5} defaultValue={0.3} onChange={onChange} {...extra} />)
  return { onChange, knob: screen.getByRole('slider', { name: 'DECAY' }) }
}

test('exposes value and live display through ARIA', () => {
  const { knob } = setup({ display: 0.62, modAmount: 0.2 })
  expect(knob.getAttribute('aria-valuenow')).toBe('50')
  expect(knob.getAttribute('aria-valuetext')).toBe('62, modulated 20')
})

test('keyboard steps the value', () => {
  const { knob, onChange } = setup()
  fireEvent.keyDown(knob, { key: 'ArrowUp' })
  expect(onChange).toHaveBeenLastCalledWith(0.51)
  fireEvent.keyDown(knob, { key: 'ArrowLeft', shiftKey: true })
  expect(onChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.509)
  fireEvent.keyDown(knob, { key: 'End' })
  expect(onChange).toHaveBeenLastCalledWith(1)
  fireEvent.keyDown(knob, { key: 'Home' })
  expect(onChange).toHaveBeenLastCalledWith(0)
})

test('double click resets to default', () => {
  const { knob, onChange } = setup()
  fireEvent.doubleClick(knob)
  expect(onChange).toHaveBeenLastCalledWith(0.3)
})

test('dropping a modulator reports its slot', () => {
  const onDropModulator = vi.fn()
  const { knob } = setup({ onDropModulator })
  const dataTransfer = { types: [MOD_DRAG_TYPE], getData: (t: string) => (t === MOD_DRAG_TYPE ? '3' : '') }
  fireEvent.dragOver(knob, { dataTransfer })
  fireEvent.drop(knob, { dataTransfer })
  expect(onDropModulator).toHaveBeenCalledWith(3)
})

test('a drop without modulator data is ignored', () => {
  const onDropModulator = vi.fn()
  const { knob } = setup({ onDropModulator })
  fireEvent.drop(knob, { dataTransfer: { types: ['text/plain'], getData: () => '' } })
  expect(onDropModulator).not.toHaveBeenCalled()
})

test('label button selects the parameter', () => {
  const onSelect = vi.fn()
  setup({ onSelect })
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  expect(onSelect).toHaveBeenCalled()
})

test('learning adds a non-colour cue', () => {
  const { knob } = setup({ learning: true, display: 0.5 })
  expect(knob.getAttribute('aria-valuetext')).toContain('LEARN')
  expect(screen.getByText('L')).toBeTruthy()
})

test('small size renders 40 px and ariaLabel overrides the accessible name', () => {
  render(<Knob label="FLT" ariaLabel="KICK filter" size="sm" value={0.5} defaultValue={0.5} onChange={() => {}} />)
  const knob = screen.getByRole('slider', { name: 'KICK filter' })
  expect(knob.getAttribute('width')).toBe('40')
})
