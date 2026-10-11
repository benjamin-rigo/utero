import { expect, test } from 'vitest'
import { BUS_PARAMS, faderDb, MACHINES, MASTER_PARAMS, MID_PARAMS, noteName, paramLabel, rowLabel, rowParamMetas, SUB_PARAMS } from './machines'

const names = ['KICK', 'KCK2', 'HH', 'OH', 'SNR', 'NOIS', 'SMPL', 'SUB', 'MID', 'LD1', 'LD2', 'PAD', 'ORN']

test('param tables mirror the engine', () => {
  expect(SUB_PARAMS.map((p) => p.default)).toEqual([0.5, 0, 0.1, 0, 0.6, 0.2, 0.8, 0])
  expect(MID_PARAMS.map((p) => p.default)).toEqual([0, 0.3, 0, 0.05, 0.2, 0.5, 0, 0, 0.45, 0.3, 0.5, 0.4, 0.2, 0.5, 0, 0.7, 0.5])
  expect(BUS_PARAMS.map((p) => p.default)).toEqual([0.5, 0, 0.8])
  expect(MASTER_PARAMS.map((p) => p.default)).toEqual([0.2, 0.6, 0.5, 1, 0.1, 0.5, 0.5, 0, 0.975, 0, 0.8])
})

test('machines sit on KICK, KCK2, SUB and MID', () => {
  expect(MACHINES.map((m) => m?.name ?? null)).toEqual(['ANALOG BD', 'ANALOG BD', null, null, null, null, null, 'SUB', 'MID BASS', null, null, null, null])
  expect(MACHINES[8]?.pages.map((p) => p.name)).toEqual(['SRC', 'FLTR', 'AMP'])
  expect(MACHINES[7]?.melodic).toBe(true)
  expect(MACHINES[0]?.melodic).toBe(false)
})

test('rows and labels', () => {
  expect(rowParamMetas(16)).toBe(BUS_PARAMS)
  expect(rowParamMetas(21)).toBe(MASTER_PARAMS)
  expect(rowParamMetas(5)).toEqual([])
  expect(rowLabel(names, 7)).toBe('SUB')
  expect(rowLabel(names, 16)).toBe('BASS BUS')
  expect(rowLabel(names, 21)).toBe('MASTER')
  expect(paramLabel(names, 13, 0)).toBe('KICK BUS.FLT')
})

test('note names and fader dB', () => {
  expect(noteName(41)).toBe('F2')
  expect(noteName(60)).toBe('C4')
  expect(noteName(61)).toBe('C#4')
  expect(faderDb(0)).toBe('−∞')
  expect(faderDb(0.8)).toBe('+0.0 dB')
  expect(faderDb(1)).toBe('+6.0 dB')
})
