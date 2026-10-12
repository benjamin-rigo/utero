// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { EnvGraph } from './EnvGraph'

afterEach(cleanup)

test('stacked ATK/HOLD points: dragging right grows HOLD', () => {
  const onChange = vi.fn()
  const { container } = render(<div style={{ width: 100, height: 40 }}><EnvGraph values={[0, 0, 0.5, 0.5, 0.3]} onChange={onChange} /></div>)
  const svg = container.querySelector('[aria-hidden="true"]')! as HTMLElement
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.pointerDown(svg, { clientX: 4, clientY: 4, pointerId: 1 })
  fireEvent.pointerMove(svg, { clientX: 10, clientY: 4, pointerId: 1 })
  expect(onChange.mock.calls[0][0]).toBe(1)
  expect(onChange.mock.calls[0][1]).toBeCloseTo(6 / (92 / 3))
})
