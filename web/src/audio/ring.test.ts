import { describe, expect, test } from 'vitest'
import { CMD_WORDS } from './ops'
import { CommandRing } from './ring'

const out = () => new Float32Array(CMD_WORDS)

describe('CommandRing', () => {
  test('pops commands in FIFO order', () => {
    const r = CommandRing.create(8)
    r.push([1, 10])
    r.push([2, 20])
    const o = out()
    expect(r.pop(o)).toBe(true)
    expect([o[0], o[1]]).toEqual([1, 10])
    expect(r.pop(o)).toBe(true)
    expect([o[0], o[1]]).toEqual([2, 20])
    expect(r.pop(o)).toBe(false)
  })

  test('refuses to push when full and keeps unread commands intact', () => {
    const r = CommandRing.create(4)
    expect(r.push([1])).toBe(true)
    expect(r.push([2])).toBe(true)
    expect(r.push([3])).toBe(true)
    expect(r.push([4])).toBe(false)
    const o = out()
    const seen: number[] = []
    while (r.pop(o)) seen.push(o[0])
    expect(seen).toEqual([1, 2, 3])
  })

  test('stays ordered across many wraparounds', () => {
    const r = CommandRing.create(5)
    const o = out()
    for (let i = 0; i < 1000; i++) {
      expect(r.push([i, i * 2])).toBe(true)
      expect(r.pop(o)).toBe(true)
      expect([o[0], o[1]]).toEqual([i, i * 2])
    }
  })

  test('attach sees the same queue (other thread view)', () => {
    const a = CommandRing.create(8)
    const b = CommandRing.attach(a.sab)
    a.push([7, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const o = out()
    expect(b.pop(o)).toBe(true)
    expect(Array.from(o)).toEqual([7, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('zero-fills unused command words when a slot is reused', () => {
    const r = CommandRing.create(2)
    r.push([5, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    r.pop(out())
    r.push([9])
    r.pop(out())
    r.push([6]) // lands in slot 0 again
    const o = out()
    r.pop(o)
    expect(Array.from(o)).toEqual([6, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})
