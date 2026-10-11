import type { EngineExports } from './exports'
import { Op } from './ops'

export function dispatch(ex: EngineExports, c: ArrayLike<number>): void {
  switch (c[0]) {
    case Op.SetParam: ex.utero_set_param(c[1], c[2], c[3]); break
    case Op.SetStep: ex.utero_set_step(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9]); break
    case Op.SetLength: ex.utero_set_length(c[1], c[2]); break
    case Op.SetSpeed: ex.utero_set_speed(c[1], c[2]); break
    case Op.Play: ex.utero_play(); break
    case Op.Stop: ex.utero_stop(); break
    case Op.SetBpm: ex.utero_set_bpm(c[1]); break
    case Op.SetFill: ex.utero_set_fill(c[1]); break
  }
}
