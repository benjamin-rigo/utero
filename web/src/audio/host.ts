import workletUrl from './worklet.ts?worker&url'
import { assertIsolated } from './isolation'
import { CommandRing } from './ring'
import { SNAP_FLOATS } from './snapshot'

export interface EngineHost {
  ctx: AudioContext
  send(cmd: number[]): void
  snapshot: Float32Array
}

/** Must be called from a user gesture (browsers block audio otherwise). */
export async function startEngine(onError: (message: string) => void): Promise<EngineHost> {
  assertIsolated(globalThis.crossOriginIsolated)
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  try {
    await ctx.audioWorklet.addModule(workletUrl)
    const module = await WebAssembly.compileStreaming(fetch('/utero.wasm'))
    const ring = CommandRing.create(2048)
    const snap = new SharedArrayBuffer(SNAP_FLOATS * 4)
    const node = new AudioWorkletNode(ctx, 'utero-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module, ring: ring.sab, snap },
    })
    node.onprocessorerror = () => onError('Audio engine crashed – reload the page')
    node.connect(ctx.destination)
    await ctx.resume()
    return {
      ctx,
      snapshot: new Float32Array(snap),
      send(cmd) {
        if (!ring.push(cmd)) console.warn('utero: command ring full, dropped opcode', cmd[0])
      },
    }
  } catch (e) {
    await ctx.close()
    throw e
  }
}
