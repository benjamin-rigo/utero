import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import type { WasmExports } from './exports'
import { SNAP_EFFECTIVE, SNAP_FLOATS, SNAP_MUTED } from './snapshot'

async function load(): Promise<WasmExports> {
  const path = fileURLToPath(new URL('../../public/utero.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {})
  return instance.exports as unknown as WasmExports
}

test('wasm engine renders a kick after play', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_step(0, 0, 1, 1, 100, 0, 1, 2, 0, 41)
  ex.utero_play()
  ex.utero_process(128)
  const out = new Float32Array(ex.memory.buffer, ex.utero_out_l(), 128)
  expect(out.every(Number.isFinite)).toBe(true)
  expect(Math.max(...Array.from(out, Math.abs))).toBeGreaterThan(0)
  expect(ex.utero_tick()).toBeGreaterThan(0)
  expect(ex.utero_playhead(0)).toBe(0)
})

test('wasm engine survives garbage commands without trapping', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_param(99, 99, NaN)
  ex.utero_set_step(99, 999, 1, NaN, 500, 42, 0, 0, 999, 300)
  ex.utero_set_length(0, 0)
  ex.utero_set_bpm(NaN)
  ex.utero_play()
  ex.utero_process(4096)
  expect(ex.utero_playhead(99)).toBe(-1)
})

test('engine snapshot layout matches the UI', async () => {
  const ex = await load()
  expect(ex.utero_snapshot_len()).toBe(SNAP_FLOATS)
})

test('a routed LFO moves the effective value in the snapshot', async () => {
  const ex = await load()
  ex.utero_init(48000)
  // slot 0: LFO square, unsynced 0.01 Hz → output stays +1 during the test
  ex.utero_set_modulator(0, 1, 6, 0, 0, 6, 0.01, 0, 1, 0, -1, 0, 1)
  ex.utero_set_route(0, 0, 0, 1, 0.3)
  for (let i = 0; i < 100; i++) ex.utero_process(128)
  const snap = new Float32Array(ex.memory.buffer, ex.utero_snapshot(), SNAP_FLOATS)
  expect(snap[SNAP_EFFECTIVE + 1]).toBeCloseTo(0.5 + 0.3, 1)
})

test('garbage modulation commands do not trap', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_modulator(99, 9, 99, 9, 1, 255, NaN, NaN, 1, 9, 999, NaN, NaN)
  ex.utero_set_modulator(0, 1, 0, 0, 1, 255, NaN, NaN, 1, 9, 999, NaN, NaN)
  ex.utero_set_route(999, 99, 99, 99, NaN)
  ex.utero_set_route(0, 0, 0, 0, Infinity)
  ex.utero_clear_route(999)
  ex.utero_set_mod_step(0, 99, NaN)
  ex.utero_set_mod_step_len(0, 0)
  ex.utero_set_macro_target(99, 99, 0, 0, 0, 1)
  ex.utero_set_macro_target(0, 0, 99, 99, NaN, 1)
  ex.utero_set_macro_pos(0, NaN)
  ex.utero_clear_macro_target(99, 99)
  ex.utero_set_bus_mute(99, 1, 1)
  ex.utero_set_param(99, 0, 0.5)
  ex.utero_play()
  for (let i = 0; i < 10; i++) ex.utero_process(128)
  const out = new Float32Array(ex.memory.buffer, ex.utero_out_l(), 128)
  expect(out.every(Number.isFinite)).toBe(true)
})

test('BASS plays a note through the BASS bus', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_step(7, 0, 1, 1, 100, 0, 1, 2, 0, 41)
  ex.utero_play()
  let peak = 0
  for (let i = 0; i < 100; i++) {
    ex.utero_process(128)
    const out = new Float32Array(ex.memory.buffer, ex.utero_out_l(), 128)
    peak = Math.max(peak, ...Array.from(out, Math.abs))
  }
  expect(peak).toBeGreaterThan(0.01)
})

test('bus mute reaches the snapshot', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_bus_mute(2, 1, 0)
  ex.utero_process(128)
  const snap = new Float32Array(ex.memory.buffer, ex.utero_snapshot(), SNAP_FLOATS)
  expect(snap[SNAP_MUTED + 2]).toBe(1)
  expect(snap[SNAP_MUTED + 1]).toBe(0)
})

test('engine param defaults match the UI tables', async () => {
  const { rowParamMetas } = await import('@/state/machines')
  const { initialState, rowParams } = await import('@/state/store')
  const ui = initialState()
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_process(1)
  const snap = new Float32Array(ex.memory.buffer, ex.utero_snapshot(), SNAP_FLOATS)
  for (let row = 0; row <= 20; row++) {
    rowParamMetas(row).forEach((meta, p) => {
      expect(snap[SNAP_EFFECTIVE + row * 24 + p], `row ${row} param ${meta.name}`).toBeCloseTo(rowParams(ui, row)[p], 3)
    })
  }
})
