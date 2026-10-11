import { expect, test } from 'vitest'
import { parseBpmDraft } from './bpmDraft'

test('parses decimal numbers', () => {
  expect(parseBpmDraft('140')).toBe(140)
  expect(parseBpmDraft(' 127.5 ')).toBe(127.5)
})

test('rejects empty and non-numeric drafts', () => {
  expect(parseBpmDraft('')).toBeNull()
  expect(parseBpmDraft('   ')).toBeNull()
  expect(parseBpmDraft('abc')).toBeNull()
  expect(parseBpmDraft('1e999')).toBeNull()
})
