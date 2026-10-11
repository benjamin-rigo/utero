import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import type { WasmExports } from './exports'

async function load(): Promise<WasmExports> {
  const path = fileURLToPath(new URL('../../public/utero.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {})
  return instance.exports as unknown as WasmExports
}

test('wasm engine renders a kick after play', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_step(0, 0, 1, 1, 100, 0, 1, 2, 0)
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
  ex.utero_set_step(99, 999, 1, NaN, 500, 42, 0, 0, 999)
  ex.utero_set_length(0, 0)
  ex.utero_set_bpm(NaN)
  ex.utero_play()
  ex.utero_process(4096)
  expect(ex.utero_playhead(99)).toBe(-1)
})
