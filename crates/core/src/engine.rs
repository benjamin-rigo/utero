use crate::kick::{KickParams, KickVoice};
use crate::rng::Rng;
use crate::seq::{CondCtx, Step, Track};
use crate::transport::Transport;

pub const BLOCK: usize = 128;
pub const TRACKS: usize = 13;
pub const KICK_TRACKS: usize = 2;

pub struct Engine {
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    transport: Transport,
    tracks: [Track; TRACKS],
    kicks: [KickVoice; KICK_TRACKS],
    kick_params: [KickParams; KICK_TRACKS],
    rng: Rng,
    fill: bool,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Engine {
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            transport: Transport::new(sample_rate),
            tracks: [Track::new(); TRACKS],
            kicks: core::array::from_fn(|i| KickVoice::new(sample_rate, 0x00C0_FFEE + i as u32)),
            kick_params: core::array::from_fn(|_| KickParams::new(sample_rate)),
            rng: Rng::new(0x5EED),
            fill: false,
        }
    }

    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.reset();
        }
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
        if !norm.is_finite() {
            return;
        }
        if let Some(p) = self.kick_params.get_mut(track) {
            p.set_norm(param, norm);
        }
    }

    pub fn playhead(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(-1, |t| t.playhead() as i32)
    }

    pub fn ticks(&self) -> u64 {
        self.transport.ticks()
    }

    pub fn process(&mut self, frames: usize) {
        for i in 0..frames.min(BLOCK) {
            if let Some(tick) = self.transport.tick() {
                self.on_tick(tick);
            }
            let mut s = 0.0;
            for k in 0..KICK_TRACKS {
                self.kick_params[k].advance();
                s += self.kicks[k].render(&self.kick_params[k]);
            }
            let y = s.clamp(-1.0, 1.0);
            self.out_l[i] = y;
            self.out_r[i] = y;
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
}
