export interface EngineExports {
  utero_set_param(track: number, param: number, value: number): void
  utero_set_step(track: number, step: number, trig: number, vel: number, prob: number, cond: number, a: number, b: number, micro: number): void
  utero_set_length(track: number, len: number): void
  utero_set_speed(track: number, code: number): void
  utero_play(): void
  utero_stop(): void
  utero_set_bpm(bpm: number): void
  utero_set_fill(on: number): void
}

export interface WasmExports extends EngineExports {
  memory: WebAssembly.Memory
  utero_init(sampleRate: number): void
  utero_process(frames: number): void
  utero_out_l(): number
  utero_out_r(): number
  utero_tick(): number
  utero_playhead(track: number): number
}
