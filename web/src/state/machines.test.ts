import { expect, test } from 'vitest'
import { KICK_PARAMS } from './kickParams'
import { BASS_PARAMS, BUS_PARAMS, faderDb, formatParam, MACHINES, MASTER_PARAMS, noteName, paramLabel, rowLabel, rowParamMetas } from './machines'

const names = ['KICK', 'KCK2', 'HH', 'OH', 'SNR', 'NOIS', 'SMPL', 'BASS', 'LD1', 'LD2', 'PAD', 'ORN']

test('param tables mirror the engine', () => {
  expect(KICK_PARAMS.map((p) => p.name)).toEqual(['TUNE', 'SWEEP', 'S.TIME', 'DECAY', 'CLICK', 'NOISE', 'TONE', 'LEVEL'])
  expect(BASS_PARAMS.map((p) => p.default)).toEqual([0.8, 0.35, 0.45, 0.4, 0.2, 0.5, 0, 0.8, 0])
  expect(BUS_PARAMS.map((p) => p.default)).toEqual([0.5, 0, 0.8])
  expect(MASTER_PARAMS.map((p) => p.default)).toEqual([0.2, 0.6, 0.5, 1, 0.1, 0.5, 0.5, 0, 0.975, 0, 0.8])
})

test('machines sit on KICK, KCK2 and BASS with one 8-knob page each', () => {
  expect(MACHINES.map((m) => m?.name ?? null)).toEqual(['ANALOG BD', 'ANALOG BD', null, null, null, null, null, 'BASS', null, null, null, null])
  expect(MACHINES[0]?.pages).toEqual([{ name: 'KICK', params: [0, 1, 2, 3, 4, 5, 6, 7] }])
  expect(MACHINES[7]?.pages[0].params).toHaveLength(8)
  expect(MACHINES[7]?.switches).toEqual([{ param: 8, label: 'SUB OCT' }])
  expect(MACHINES[7]?.melodic).toBe(true)
})

test('rows and labels', () => {
  expect(rowParamMetas(15)).toBe(BUS_PARAMS)
  expect(rowParamMetas(20)).toBe(MASTER_PARAMS)
  expect(rowParamMetas(8)).toEqual([])
  expect(rowLabel(names, 7)).toBe('BASS')
  expect(rowLabel(names, 15)).toBe('BASS BUS')
  expect(rowLabel(names, 20)).toBe('MASTER')
  expect(paramLabel(names, 12, 0)).toBe('KICK BUS.FLT')
})

test('values are shown in real units', () => {
  expect(formatParam(KICK_PARAMS[0], 0.270567)).toBe('F1')
  expect(formatParam(KICK_PARAMS[0], 0.2925)).toBe('F#1 -47')
  expect(formatParam(KICK_PARAMS[3], 0)).toBe('50 ms')
  expect(formatParam(KICK_PARAMS[3], 1)).toBe('2.00 s')
  expect(formatParam(KICK_PARAMS[1], 0.5)).toBe('24 st')
  expect(formatParam(KICK_PARAMS[4], 0.3)).toBe('30%')
  expect(formatParam(KICK_PARAMS[7], 0.8)).toBe('+0.0 dB')
  expect(formatParam(KICK_PARAMS[6], 1)).toBe('12.0 kHz')
  expect(formatParam(BASS_PARAMS[8], 1)).toBe('−1')
  expect(formatParam(BUS_PARAMS[0], 0.5)).toBe('OFF')
  expect(formatParam(BUS_PARAMS[0], 0)).toBe('LP 20 Hz')
  expect(formatParam(BUS_PARAMS[0], 1)).toBe('HP 20.0 kHz')
  expect(formatParam(MASTER_PARAMS[6], 1)).toBe('+6.0 dB')
  expect(formatParam(MASTER_PARAMS[9], 1)).toBe('CLIP')
})

test('note names and fader dB', () => {
  expect(noteName(41)).toBe('F2')
  expect(noteName(61)).toBe('C#4')
  expect(faderDb(0)).toBe('−∞')
  expect(faderDb(1)).toBe('+6.0 dB')
})
