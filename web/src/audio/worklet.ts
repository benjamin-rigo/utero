import { dispatch } from './dispatch'
import type { WasmExports } from './exports'
import { CMD_WORDS } from './ops'
import { CommandRing } from './ring'
import { SNAP_FLOATS } from './snapshot'

interface Options {
  module: WebAssembly.Module
  ring: SharedArrayBuffer
  snap: SharedArrayBuffer
}

class UteroProcessor extends AudioWorkletProcessor {
  private readonly ex: WasmExports
  private readonly ring: CommandRing
  private readonly snap: Float32Array
  private readonly cmd = new Float32Array(CMD_WORDS)
  private mem: ArrayBuffer | null = null
  private outL = new Float32Array(0)
  private outR = new Float32Array(0)
  private snapView = new Float32Array(0)

  constructor(options: AudioWorkletNodeOptions) {
    super()
    const { module, ring, snap } = options.processorOptions as Options
    this.ex = new WebAssembly.Instance(module, {}).exports as unknown as WasmExports
    // A stale utero.wasm next to a newer UI would show wrong values; fail loudly instead.
    if (this.ex.utero_snapshot_len() !== SNAP_FLOATS) {
      throw new Error(`snapshot layout mismatch: engine ${this.ex.utero_snapshot_len()} vs UI ${SNAP_FLOATS}`)
    }
    this.ex.utero_init(sampleRate)
    this.ring = CommandRing.attach(ring)
    this.snap = new Float32Array(snap)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    while (this.ring.pop(this.cmd)) dispatch(this.ex, this.cmd)
    const out = outputs[0]
    const left = out[0]
    const n = left.length
    this.ex.utero_process(n)
    // Re-create views only if wasm memory grew; avoids per-block allocation.
    if (this.mem !== this.ex.memory.buffer || this.outL.length !== n) {
      this.mem = this.ex.memory.buffer
      this.outL = new Float32Array(this.mem, this.ex.utero_out_l(), n)
      this.outR = new Float32Array(this.mem, this.ex.utero_out_r(), n)
      this.snapView = new Float32Array(this.mem, this.ex.utero_snapshot(), SNAP_FLOATS)
    }
    left.set(this.outL)
    out[1]?.set(this.outR)
    this.snap.set(this.snapView)
    return true
  }
}

registerProcessor('utero-engine', UteroProcessor)
