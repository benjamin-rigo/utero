import { dispatch } from './dispatch'
import type { WasmExports } from './exports'
import { CMD_WORDS } from './ops'
import { CommandRing } from './ring'
import { SNAP_TRACKS } from './snapshot'

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

  constructor(options: AudioWorkletNodeOptions) {
    super()
    const { module, ring, snap } = options.processorOptions as Options
    this.ex = new WebAssembly.Instance(module, {}).exports as unknown as WasmExports
    this.ex.utero_init(sampleRate)
    this.ring = CommandRing.attach(ring)
    this.snap = new Float32Array(snap)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    while (this.ring.pop(this.cmd)) dispatch(this.ex, this.cmd)
    const [left, right] = outputs[0]
    const n = left.length
    this.ex.utero_process(n)
    // Re-create views only if wasm memory grew; avoids per-block allocation.
    if (this.mem !== this.ex.memory.buffer || this.outL.length !== n) {
      this.mem = this.ex.memory.buffer
      this.outL = new Float32Array(this.mem, this.ex.utero_out_l(), n)
      this.outR = new Float32Array(this.mem, this.ex.utero_out_r(), n)
    }
    left.set(this.outL)
    right?.set(this.outR)
    this.snap[0] = this.ex.utero_tick()
    for (let t = 0; t < SNAP_TRACKS; t++) this.snap[1 + t] = this.ex.utero_playhead(t)
    return true
  }
}

registerProcessor('utero-engine', UteroProcessor)
