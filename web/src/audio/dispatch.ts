import type { EngineExports } from './exports'
import { Op } from './ops'

export function dispatch(ex: EngineExports, c: ArrayLike<number>): void {
  switch (c[0]) {
    case Op.SetParam: ex.utero_set_param(c[1], c[2], c[3]); break
    case Op.SetStep: ex.utero_set_step(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10]); break
    case Op.SetLength: ex.utero_set_length(c[1], c[2]); break
    case Op.SetSpeed: ex.utero_set_speed(c[1], c[2]); break
    case Op.Play: ex.utero_play(); break
    case Op.Stop: ex.utero_stop(); break
    case Op.SetBpm: ex.utero_set_bpm(c[1]); break
    case Op.SetFill: ex.utero_set_fill(c[1]); break
    case Op.SetModulator:
      ex.utero_set_modulator(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12], c[13], c[14]); break
    case Op.SetModStep: ex.utero_set_mod_step(c[1], c[2], c[3]); break
    case Op.SetModStepLen: ex.utero_set_mod_step_len(c[1], c[2]); break
    case Op.SetModEnv: ex.utero_set_mod_env(c[1], c[2], c[3], c[4], c[5], c[6]); break
    case Op.SetRoute: ex.utero_set_route(c[1], c[2], c[3], c[4], c[5]); break
    case Op.ClearRoute: ex.utero_clear_route(c[1]); break
    case Op.SetMacroTarget: ex.utero_set_macro_target(c[1], c[2], c[3], c[4], c[5], c[6]); break
    case Op.ClearMacroTarget: ex.utero_clear_macro_target(c[1], c[2]); break
    case Op.SetMacroPos: ex.utero_set_macro_pos(c[1], c[2]); break
    case Op.SetBusMute: ex.utero_set_bus_mute(c[1], c[2], c[3]); break
    case Op.SetFxOrder: ex.utero_set_fx_order(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9]); break
  }
}
