// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { createStore, type Store } from '@/state/store'
import { Master, Mixer } from './Mixer'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <><Mixer state={state} frame={null} store={store} /><Master state={state} frame={null} store={store} /></>
}

const setup = () => {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('eight strips with mute buttons', () => {
  setup()
  expect(screen.getAllByRole('button', { name: /^Mute / })).toHaveLength(8)
})

test('mute toggles the bus', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Mute BASS' }))
  expect(store.getState().buses[3].muted).toBe(true)
  expect(screen.getByRole('button', { name: 'Mute BASS' }).getAttribute('aria-pressed')).toBe('true')
})

test('level fader sets the bus LEVEL param and shows dB', () => {
  const store = setup()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'KICK level' }), { key: 'End' })
  expect(store.getState().buses[0].params[2]).toBe(1)
  expect(screen.getByText('+6.0 dB')).toBeTruthy()
})

test('dropping a modulator on a bus filter routes to that bus row', () => {
  const store = setup()
  const dataTransfer = { types: [MOD_DRAG_TYPE], getData: () => '0' }
  fireEvent.drop(screen.getByRole('slider', { name: 'BASS FLT' }), { dataTransfer })
  expect(store.getState().routes[0]).toMatchObject({ src: 0, track: 15, param: 0 })
})

test('master mode is a limit | clip choice', () => {
  const store = setup()
  const group = screen.getByRole('radiogroup', { name: 'Master mode' })
  expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe('limit')
  fireEvent.click(screen.getByRole('radio', { name: 'clip' }))
  expect(store.getState().master.params[9]).toBe(1)
  fireEvent.click(screen.getByRole('radio', { name: 'limit' }))
  expect(store.getState().master.params[9]).toBe(0)
})

test('MUTE Q toggles quantized mutes', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'MUTE Q' }))
  expect(store.getState().muteQuantize).toBe(false)
})
