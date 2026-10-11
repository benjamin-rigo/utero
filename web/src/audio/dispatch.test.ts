import { expect, test } from 'vitest'
import type { EngineExports } from './exports'
import { dispatch } from './dispatch'
import { cmdPlay, cmdSetBpm, cmdSetFill, cmdSetLength, cmdSetParam, cmdSetSpeed, cmdSetStep, cmdStop } from './ops'

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
  }
  return { ex, calls }
}

test('every command builder reaches the matching export', () => {
  const { ex, calls } = fake()
  const step = { trig: true, vel: 0.5, prob: 60, cond: 1 as const, a: 2, b: 4, micro: -3 }
  for (const cmd of [
    cmdSetParam(1, 2, 0.25), cmdSetStep(0, 5, step), cmdSetLength(1, 13), cmdSetSpeed(1, 2),
    cmdPlay(), cmdStop(), cmdSetBpm(128), cmdSetFill(true),
  ]) dispatch(ex, cmd)
  expect(calls).toEqual([
    ['set_param', [1, 2, 0.25]],
    ['set_step', [0, 5, 1, 0.5, 60, 1, 2, 4, -3]],
    ['set_length', [1, 13]],
    ['set_speed', [1, 2]],
    ['play', []],
    ['stop', []],
    ['set_bpm', [128]],
    ['set_fill', [1]],
  ])
})

test('unknown opcode is ignored', () => {
  const { ex, calls } = fake()
  dispatch(ex, [99, 1, 2])
  expect(calls).toEqual([])
})
