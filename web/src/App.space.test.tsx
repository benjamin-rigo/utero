// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@/audio/host', () => ({ startEngine: vi.fn(() => new Promise(() => {})) }))

afterEach(cleanup)

test('Space starts the engine from anywhere, but not while typing', async () => {
  const { startEngine } = await import('@/audio/host')
  const { default: App } = await import('./App')
  const { container } = render(<App />)
  const step = container.querySelector('[data-track="0"][data-step="1"]') as HTMLButtonElement
  step.focus()
  fireEvent.keyDown(step, { code: 'Space', key: ' ' })
  expect(startEngine).toHaveBeenCalledTimes(1)
  const input = document.createElement('input')
  document.body.append(input)
  fireEvent.keyDown(input, { code: 'Space', key: ' ' })
  expect(startEngine).toHaveBeenCalledTimes(1)
})
