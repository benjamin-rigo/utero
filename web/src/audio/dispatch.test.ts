import { expect, test } from 'vitest'
import { defaultModulator } from '@/state/modulation'
import type { EngineExports } from './exports'
import { dispatch } from './dispatch'
import {
  cmdClearMacroTarget, cmdClearRoute, cmdPlay, cmdSetBpm, cmdSetFill, cmdSetLength, cmdSetMacroPos, cmdSetMacroTarget,
  cmdSetModStep, cmdSetModStepLen, cmdSetModulator, cmdSetParam, cmdSetRoute, cmdSetSpeed, cmdSetStep, cmdStop, CMD_WORDS,
} from './ops'

function fake() {
  const calls: [string, number[]][] = []
  const rec = (name: string) => (...args: number[]) => { calls.push([name, args]) }
  const ex: EngineExports = {
    utero_set_param: rec('set_param'),
    utero_set_step: rec('set_step'),
    utero_set_length: rec('set_length'),
    utero_set_speed: rec('set_speed'),
    utero_play: rec('play'),
    utero_stop: rec('stop'),
    utero_set_bpm: rec('set_bpm'),
    utero_set_fill: rec('set_fill'),
    utero_set_modulator: rec('set_modulator'),
    utero_set_mod_step: rec('set_mod_step'),
    utero_set_mod_step_len: rec('set_mod_step_len'),
    utero_set_route: rec('set_route'),
    utero_clear_route: rec('clear_route'),
    utero_set_macro_target: rec('set_macro_target'),
    utero_clear_macro_target: rec('clear_macro_target'),
    utero_set_macro_pos: rec('set_macro_pos'),
  }
  return { ex, calls }
}

test('every command builder reaches the matching export with its arguments in order', () => {
  const { ex, calls } = fake()
  const step = { trig: true, vel: 0.5, prob: 60, cond: 1 as const, a: 2, b: 4, micro: -3, note: 53 }
  const mod = { ...defaultModulator(), kind: 1 as const, shape: 2, color: 1, sync: false, rateIndex: 3, hz: 0.5, phase: 0.25, bipolar: false, trigMode: 1, trigSrc: 4, smooth: 0.3, depth: 0.8 }
  for (const cmd of [
    cmdSetParam(1, 2, 0.25), cmdSetStep(0, 5, step), cmdSetLength(1, 13), cmdSetSpeed(1, 2),
    cmdPlay(), cmdStop(), cmdSetBpm(128), cmdSetFill(true),
    cmdSetModulator(3, mod), cmdSetModStep(3, 7, -0.5), cmdSetModStepLen(3, 8),
    cmdSetRoute(10, { src: 3, track: 0, param: 4, amount: -0.25 }), cmdClearRoute(10),
    cmdSetMacroTarget(2, 1, { track: 1, param: 0, a: 0.1, b: 0.9, slot: 1 }), cmdClearMacroTarget(2, 1), cmdSetMacroPos(2, 0.75),
  ]) {
    expect(cmd.length).toBeLessThanOrEqual(CMD_WORDS)
    dispatch(ex, cmd)
  }
  expect(calls).toEqual([
    ['set_param', [1, 2, 0.25]],
    ['set_step', [0, 5, 1, 0.5, 60, 1, 2, 4, -3, 53]],
    ['set_length', [1, 13]],
    ['set_speed', [1, 2]],
    ['play', []],
    ['stop', []],
    ['set_bpm', [128]],
    ['set_fill', [1]],
    ['set_modulator', [3, 1, 2, 1, 0, 3, 0.5, 0.25, 0, 1, 4, 0.3, 0.8]],
    ['set_mod_step', [3, 7, -0.5]],
    ['set_mod_step_len', [3, 8]],
    ['set_route', [10, 3, 0, 4, -0.25]],
    ['clear_route', [10]],
    ['set_macro_target', [2, 1, 1, 0, 0.1, 0.9]],
    ['clear_macro_target', [2, 1]],
    ['set_macro_pos', [2, 0.75]],
  ])
})

test('unknown opcode is ignored', () => {
  const { ex, calls } = fake()
  dispatch(ex, [99, 1, 2])
  expect(calls).toEqual([])
})
