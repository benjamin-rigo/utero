import { expect, test } from 'vitest'
import { assertIsolated } from './isolation'

test('passes when cross-origin isolated', () => {
  expect(() => assertIsolated(true)).not.toThrow()
})

test('explains the missing headers when not isolated', () => {
  expect(() => assertIsolated(false)).toThrow(/COOP\/COEP/)
})
