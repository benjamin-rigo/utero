export interface EngineExports {
  utero_set_param(track: number, param: number, value: number): void
  utero_set_step(track: number, step: number, trig: number, vel: number, prob: number, cond: number, a: number, b: number, micro: number, note: number): void
  utero_set_length(track: number, len: number): void
  utero_set_speed(track: number, code: number): void
  utero_play(): void
  utero_stop(): void
  utero_set_bpm(bpm: number): void
  utero_set_fill(on: number): void
  utero_set_modulator(slot: number, kind: number, shape: number, color: number, sync: number, rateIndex: number, hz: number,
    phase: number, bipolar: number, trigMode: number, trigSrc: number, smooth: number, depth: number): void
  utero_set_mod_step(slot: number, index: number, value: number): void
  utero_set_mod_step_len(slot: number, len: number): void
  utero_set_route(index: number, src: number, track: number, param: number, amount: number): void
  utero_clear_route(index: number): void
  utero_set_macro_target(macro: number, index: number, track: number, param: number, a: number, b: number): void
  utero_clear_macro_target(macro: number, index: number): void
  utero_set_macro_pos(macro: number, pos: number): void
  utero_set_bus_mute(bus: number, muted: number, quantized: number): void
  utero_set_mod_env(slot: number, a: number, h: number, d: number, s: number, r: number): void
  utero_set_fx_order(track: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): void
}

export interface WasmExports extends EngineExports {
  memory: WebAssembly.Memory
  utero_init(sampleRate: number): void
  utero_process(frames: number): void
  utero_out_l(): number
  utero_out_r(): number
  utero_tick(): number
  utero_playhead(track: number): number
  utero_snapshot(): number
  utero_snapshot_len(): number
}
