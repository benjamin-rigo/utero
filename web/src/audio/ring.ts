import { CMD_WORDS } from './ops'

const HEADER_BYTES = 8 // [writeIndex, readIndex] as Int32

/** Single-producer (UI) / single-consumer (audio thread) queue over a SharedArrayBuffer. */
export class CommandRing {
  private readonly header: Int32Array
  private readonly data: Float32Array
  private readonly capacity: number

  static create(capacity: number): CommandRing {
    return new CommandRing(new SharedArrayBuffer(HEADER_BYTES + capacity * CMD_WORDS * 4))
  }

  static attach(sab: SharedArrayBuffer): CommandRing {
    return new CommandRing(sab)
  }

  private constructor(readonly sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, 2)
    this.data = new Float32Array(sab, HEADER_BYTES)
    this.capacity = this.data.length / CMD_WORDS
  }

  push(cmd: ArrayLike<number>): boolean {
    const w = Atomics.load(this.header, 0)
    const next = (w + 1) % this.capacity
    if (next === Atomics.load(this.header, 1)) return false
    const base = w * CMD_WORDS
    for (let i = 0; i < CMD_WORDS; i++) this.data[base + i] = i < cmd.length ? cmd[i] : 0
    Atomics.store(this.header, 0, next)
    return true
  }

  pop(out: Float32Array): boolean {
    const r = Atomics.load(this.header, 1)
    if (r === Atomics.load(this.header, 0)) return false
    out.set(this.data.subarray(r * CMD_WORDS, r * CMD_WORDS + CMD_WORDS))
    Atomics.store(this.header, 1, (r + 1) % this.capacity)
    return true
  }
}
