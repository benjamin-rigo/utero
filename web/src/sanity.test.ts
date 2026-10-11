import { expect, test } from 'vitest'

test('SharedArrayBuffer and Atomics exist in the test runtime', () => {
  const h = new Int32Array(new SharedArrayBuffer(8))
  Atomics.store(h, 0, 5)
  expect(Atomics.load(h, 0)).toBe(5)
})
