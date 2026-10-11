use crate::kick::{KickParams, KickVoice, KICK_PARAMS, KICK_PARAM_COUNT};
use crate::macros::{MacroTarget, Macros};
use crate::modulation::{ModMatrix, ModSettings, Route, MOD_PARAMS, MOD_SLOTS, MOD_TRACKS};
use crate::rng::Rng;
use crate::seq::{CondCtx, Step, Track};
use crate::transport::Transport;

pub const BLOCK: usize = 128;
pub const TRACKS: usize = 13;
pub const KICK_TRACKS: usize = 2;

/// Snapshot layout, mirrored in web/src/audio/snapshot.ts.
pub const SNAP_TICK: usize = 0;
pub const SNAP_PLAYHEADS: usize = 1;
pub const SNAP_MODS: usize = SNAP_PLAYHEADS + TRACKS;
pub const SNAP_EFFECTIVE: usize = SNAP_MODS + MOD_SLOTS;
pub const SNAP_LEN: usize = SNAP_EFFECTIVE + TRACKS * MOD_PARAMS;

const _: () = assert!(TRACKS == MOD_TRACKS && KICK_PARAM_COUNT <= MOD_PARAMS);

pub struct Engine {
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    pub snapshot: [f32; SNAP_LEN],
    sample_rate: f32,
    transport: Transport,
    tracks: [Track; TRACKS],
    kicks: [KickVoice; KICK_TRACKS],
    kick_params: [KickParams; KICK_TRACKS],
    effective: [[f32; KICK_PARAM_COUNT]; KICK_TRACKS],
    mods: ModMatrix,
    macros: Macros,
    rng: Rng,
    fill: bool,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Engine {
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            snapshot: [0.0; SNAP_LEN],
            sample_rate,
            transport: Transport::new(sample_rate),
            tracks: [Track::new(); TRACKS],
            kicks: core::array::from_fn(|i| KickVoice::new(sample_rate, 0x00C0_FFEE + i as u32)),
            kick_params: core::array::from_fn(|_| KickParams::new(sample_rate)),
            effective: [core::array::from_fn(|i| KICK_PARAMS[i].default_norm); KICK_TRACKS],
            mods: ModMatrix::new(),
            macros: Macros::new(sample_rate),
            rng: Rng::new(0x5EED),
            fill: false,
        }
    }

    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.reset();
        }
        self.mods.restart();
        self.transport.play();
    }

    pub fn stop(&mut self) {
        self.transport.stop();
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        self.transport.set_bpm(bpm as f64);
    }

    pub fn set_fill(&mut self, on: bool) {
        self.fill = on;
    }

    pub fn set_step(&mut self, track: usize, index: usize, step: Step) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_step(index, step);
        }
    }

    pub fn set_length(&mut self, track: usize, len: u8) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_length(len);
        }
    }

    pub fn set_speed(&mut self, track: usize, code: u8) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_speed(code);
        }
    }

    pub fn set_param(&mut self, track: usize, param: usize, norm: f32) {
        if let Some(p) = self.kick_params.get_mut(track) {
            p.set_norm(param, norm);
        }
    }

    pub fn set_modulator(&mut self, slot: usize, s: ModSettings) {
        self.mods.set_modulator(slot, s);
    }

    pub fn set_mod_step(&mut self, slot: usize, i: usize, v: f32) {
        self.mods.set_step(slot, i, v);
    }

    pub fn set_mod_step_len(&mut self, slot: usize, len: u8) {
        self.mods.set_step_len(slot, len);
    }

    pub fn set_route(&mut self, index: usize, route: Route) {
        self.mods.set_route(index, route);
    }

    pub fn clear_route(&mut self, index: usize) {
        self.mods.clear_route(index);
    }

    pub fn set_macro_target(&mut self, m: usize, i: usize, t: MacroTarget) {
        self.macros.set_target(m, i, t);
    }

    pub fn clear_macro_target(&mut self, m: usize, i: usize) {
        self.macros.clear_target(m, i);
    }

    pub fn set_macro_pos(&mut self, m: usize, pos: f32) {
        self.macros.set_pos(m, pos);
    }

    pub fn mod_output(&self, slot: usize) -> f32 {
        self.mods.output(slot)
    }

    pub fn effective_norm(&self, track: usize, param: usize) -> f32 {
        self.effective.get(track).and_then(|row| row.get(param)).copied().unwrap_or(-1.0)
    }

    pub fn playhead(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(-1, |t| t.playhead() as i32)
    }

    pub fn ticks(&self) -> u64 {
        self.transport.ticks()
    }

    pub fn process(&mut self, frames: usize) {
        let bpm = self.transport.bpm() as f32;
        for i in 0..frames.min(BLOCK) {
            if let Some(tick) = self.transport.tick() {
                self.on_tick(tick);
            }
            self.mods.advance(bpm, self.sample_rate);
            self.macros.advance();
            let mut s = 0.0;
            for k in 0..KICK_TRACKS {
                // base (smoothed) → macro override → + modulation → clamp → map
                let mut norms = self.kick_params[k].next_norms();
                self.macros.apply(k as u8, &mut norms);
                for (p, v) in norms.iter_mut().enumerate() {
                    *v = (*v + self.mods.sum(k, p)).clamp(0.0, 1.0);
                }
                self.kick_params[k].apply_norms(&norms);
                self.effective[k] = norms;
                s += self.kicks[k].render(&self.kick_params[k]);
            }
            let y = if s.is_finite() { s.clamp(-1.0, 1.0) } else { 0.0 };
            self.out_l[i] = y;
            self.out_r[i] = y;
        }
        self.write_snapshot();
    }

    fn write_snapshot(&mut self) {
        self.snapshot[SNAP_TICK] = self.transport.ticks() as f32;
        for t in 0..TRACKS {
            self.snapshot[SNAP_PLAYHEADS + t] = self.tracks[t].playhead() as f32;
        }
        for m in 0..MOD_SLOTS {
            self.snapshot[SNAP_MODS + m] = self.mods.output(m);
        }
        for k in 0..KICK_TRACKS {
            for p in 0..KICK_PARAM_COUNT {
                self.snapshot[SNAP_EFFECTIVE + k * MOD_PARAMS + p] = self.effective[k][p];
            }
        }
    }

    fn on_tick(&mut self, tick: u64) {
        let mut neighbor = false;
        for t in 0..TRACKS {
            let mut ctx = CondCtx { fill: self.fill, neighbor, rng: &mut self.rng };
            if let Some(vel) = self.tracks[t].on_tick(tick, &mut ctx) {
                if t < KICK_TRACKS {
                    self.kicks[t].trigger(vel, &mut self.rng);
                }
                self.mods.on_track_trigger(t);
            }
            neighbor = self.tracks[t].last_cond();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kick::DECAY;

    fn render_seconds(e: &mut Engine, secs: f32) -> Vec<f32> {
        let mut out = Vec::new();
        let blocks = (48_000.0 * secs / BLOCK as f32) as usize;
        for _ in 0..blocks {
            e.process(BLOCK);
            out.extend_from_slice(&e.out_l);
        }
        out
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
    }

    fn quarter_kick(e: &mut Engine) {
        for s in [0, 4, 8, 12] {
            e.set_step(0, s, Step { trig: true, ..Step::default() });
        }
    }

    #[test]
    fn silent_when_stopped() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        assert!(render_seconds(&mut e, 0.5).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn kick_lands_on_the_second_beat() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0); // quarter = 24000 samples
        e.set_param(0, DECAY, 0.0); // 50 ms
        quarter_kick(&mut e);
        e.play();
        let out = render_seconds(&mut e, 1.0);
        assert!(rms(&out[23_000..23_900]) < 0.01);
        assert!(rms(&out[24_000..24_900]) > 0.1);
    }

    #[test]
    fn output_is_clamped_to_unit_range() {
        let mut e = Engine::new(48_000.0);
        for t in 0..KICK_TRACKS {
            for p in 0..9 {
                e.set_param(t, p, 1.0);
            }
            e.set_step(t, 0, Step { trig: true, ..Step::default() });
        }
        e.set_param(0, crate::kick::DRIVE, 0.0);
        e.play();
        assert!(render_seconds(&mut e, 1.0).iter().all(|s| s.abs() <= 1.0));
    }

    #[test]
    fn out_of_range_commands_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_param(99, 0, 0.5);
        e.set_param(0, 50, 0.5);
        e.set_param(0, 0, f32::NAN);
        e.set_step(99, 0, Step::default());
        e.set_step(0, 200, Step::default());
        e.set_length(99, 4);
        e.set_speed(99, 2);
        e.set_bpm(f32::NAN);
        assert_eq!(e.playhead(99), -1);
        e.play();
        e.process(10_000); // more frames than BLOCK
        assert!(e.out_l.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn playheads_advance_per_track_length() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0);
        e.set_length(1, 3);
        e.play();
        render_seconds(&mut e, 1.0); // 1 s at 120 bpm = 8 sixteenths
        assert_eq!(e.playhead(0), 7);
        assert_eq!(e.playhead(1), 7 % 3);
    }

    use crate::macros::MacroTarget;
    use crate::modulation::{ModKind, ModSettings, ParamRef, Route, Shape, TrigMode};

    fn square(e: &mut Engine, slot: usize) {
        e.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, sync: false, hz: 0.01, ..ModSettings::default() });
    }

    fn route(src: u8, track: u8, param: u8, amount: f32) -> Route {
        Route { src, target: ParamRef { track, param }, amount }
    }

    #[test]
    fn routed_lfo_moves_the_effective_value() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        e.set_route(0, route(0, 0, DECAY as u8, 0.3));
        render_seconds(&mut e, 0.2);
        let expected = crate::kick::KICK_PARAMS[DECAY].default_norm + 0.3;
        assert!((e.effective_norm(0, DECAY) - expected).abs() < 0.01, "{}", e.effective_norm(0, DECAY));
    }

    #[test]
    fn modulation_is_clamped_to_range() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        square(&mut e, 1);
        e.set_route(0, route(0, 0, 8, 1.0));
        e.set_route(1, route(1, 0, 8, 1.0));
        render_seconds(&mut e, 0.5);
        assert_eq!(e.effective_norm(0, 8), 1.0);
    }

    #[test]
    fn macro_overrides_the_base_value() {
        let mut e = Engine::new(48_000.0);
        e.set_macro_target(0, 0, MacroTarget { target: ParamRef { track: 1, param: 0 }, a: 0.0, b: 1.0 });
        e.set_macro_pos(0, 1.0);
        render_seconds(&mut e, 0.5);
        assert!((e.effective_norm(1, 0) - 1.0).abs() < 1e-3);
        assert!((e.effective_norm(0, 0) - crate::kick::KICK_PARAMS[0].default_norm).abs() < 1e-3);
    }

    #[test]
    fn firing_track_restarts_its_retrig_modulator() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0);
        e.set_modulator(0, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, sync: false, hz: 0.1, trig_mode: TrigMode::Retrig, trig_src: 0, ..ModSettings::default() });
        e.set_step(0, 8, Step { trig: true, ..Step::default() }); // fires at sample 48 000
        e.play();
        for _ in 0..375 {
            e.process(BLOCK);
        }
        assert!(e.mod_output(0) > 0.05);
        e.process(BLOCK);
        assert!(e.mod_output(0) < 0.01);
    }

    #[test]
    fn snapshot_mirrors_engine_state() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 2);
        e.play();
        render_seconds(&mut e, 0.3);
        assert_eq!(e.snapshot[SNAP_TICK], e.ticks() as f32);
        assert_eq!(e.snapshot[SNAP_PLAYHEADS], e.playhead(0) as f32);
        assert_eq!(e.snapshot[SNAP_MODS + 2], e.mod_output(2));
        assert_eq!(e.snapshot[SNAP_EFFECTIVE + DECAY], e.effective_norm(0, DECAY));
        assert_eq!(SNAP_LEN, 238);
    }

    #[test]
    fn bad_modulation_commands_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_modulator(99, ModSettings::default());
        e.set_mod_step(99, 0, 1.0);
        e.set_mod_step_len(99, 3);
        e.set_route(999, route(0, 0, 0, 0.5));
        e.clear_route(999);
        e.set_macro_target(99, 0, MacroTarget { target: ParamRef { track: 0, param: 0 }, a: 0.0, b: 1.0 });
        e.clear_macro_target(99, 99);
        e.set_macro_pos(99, 1.0);
        assert_eq!(e.mod_output(99), 0.0);
        assert_eq!(e.effective_norm(5, 0), -1.0);
        assert_eq!(e.effective_norm(0, 50), -1.0);
        e.play();
        render_seconds(&mut e, 0.1);
        assert!(e.out_l.iter().all(|s| s.is_finite()));
    }
}
