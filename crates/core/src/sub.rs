use core::f32::consts::TAU;

use crate::dsp::{midi_to_hz, Drive2x, Glide};
use crate::params::{Curve, ParamBank, ParamDesc};
use crate::rng::Rng;

pub const OCT: usize = 0;
pub const PHASE: usize = 1;
pub const DRIVE: usize = 2;
pub const GLIDE: usize = 3;
pub const DECAY: usize = 4;
pub const DRIFT: usize = 5;
pub const LEVEL: usize = 6;
pub const ROUTE: usize = 7;
pub const SUB_PARAM_COUNT: usize = 8;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const SUB_PARAMS: [ParamDesc; SUB_PARAM_COUNT] = [
    // 0, 1 or 2 octaves below the step note
    ParamDesc { name: "OCT", min: 0.0, max: 2.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "PHASE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "DRIVE", min: 0.0, max: 1.0, default_norm: 0.1, curve: Curve::Lin },
    ParamDesc { name: "GLIDE", min: 0.0, max: 300.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "DECAY", min: 50.0, max: 5000.0, default_norm: 0.6, curve: Curve::Exp },
    ParamDesc { name: "DRIFT", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
    // < 0.5 through the BASS bus FX, ≥ 0.5 DIRECT (bypasses bus filter/drive, keeps fader + mute)
    ParamDesc { name: "ROUTE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
];

pub fn sub_params(sample_rate: f32) -> ParamBank {
    ParamBank::new(&SUB_PARAMS, sample_rate)
}

pub fn is_direct(p: &ParamBank) -> bool {
    p.get(ROUTE) >= 0.5
}

/// A clean sine an octave or two below the note: the low end the kick sits on.
pub struct SubVoice {
    sample_rate: f32,
    phase: f32,
    amp: f32,
    attack: bool,
    att_coef: f32,
    active: bool,
    vel: f32,
    drift: f32,
    glide: Glide,
    drive: Drive2x,
}

impl SubVoice {
    pub fn new(sample_rate: f32) -> Self {
        SubVoice {
            sample_rate,
            phase: 0.0,
            amp: 0.0,
            attack: false,
            att_coef: 1.0 - (-1.0 / (0.002 * sample_rate)).exp(),
            active: false,
            vel: 0.0,
            drift: 0.0,
            glide: Glide::new(41.0),
            drive: Drive2x::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn pitch(&self) -> f32 {
        self.glide.value()
    }

    pub fn trigger(&mut self, vel: f32, note: u8, p: &ParamBank, rng: &mut Rng) {
        let sounding = self.active && self.amp > 0.05;
        if sounding && p.get(GLIDE) > 0.0 {
            self.glide.set_target(note as f32);
        } else {
            self.glide.jump(note as f32);
        }
        // Restart from PHASE only from (near) silence: resetting even a quiet tail would click.
        if !self.active || self.amp < 1.0e-3 {
            self.phase = p.get(PHASE);
        }
        self.attack = true;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
        self.drift = rng.bipolar() * 0.005 * p.get(DRIFT);
    }

    pub fn render(&mut self, p: &ParamBank) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        self.glide.set_time(p.get(GLIDE), sr);
        let semis = self.glide.next() - 12.0 * p.get(OCT).round();
        let freq = midi_to_hz(semis) * (1.0 + self.drift);
        self.phase += freq / sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        if self.attack {
            self.amp += (1.0 - self.amp) * self.att_coef;
            if self.amp > 0.999 {
                self.attack = false;
            }
        } else {
            self.amp *= (-1.0 / (p.get(DECAY) * 0.001 * sr)).exp();
            if self.amp < 1.0e-4 {
                self.active = false;
            }
        }
        let x = (self.phase * TAU).sin() * self.amp;
        self.drive.process(x, p.get(DRIVE)) * self.vel * p.get(LEVEL)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn settled(edits: &[(usize, f32)]) -> ParamBank {
        let mut p = sub_params(SR);
        for &(i, v) in edits {
            p.set_norm(i, v);
        }
        for _ in 0..48_000 {
            p.advance();
        }
        p
    }

    fn render(v: &mut SubVoice, p: &ParamBank, n: usize) -> Vec<f32> {
        (0..n).map(|_| v.render(p)).collect()
    }

    #[test]
    fn defaults_are_one_octave_down_and_about_800_ms() {
        let p = sub_params(SR);
        assert_eq!(p.get(OCT), 1.0);
        assert!((p.get(DECAY) - 792.4).abs() < 1.0);
        assert!(!is_direct(&p));
    }

    #[test]
    fn silent_until_triggered() {
        let p = settled(&[]);
        let mut v = SubVoice::new(SR);
        assert!(render(&mut v, &p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn plays_f1_for_note_41() {
        let p = settled(&[(DRIVE, 0.0), (DRIFT, 0.0)]);
        let mut v = SubVoice::new(SR);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        let out = render(&mut v, &p, 48_000);
        let crossings = out.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert!((43..=44).contains(&crossings), "{crossings}");
    }

    #[test]
    fn retrigger_while_sounding_does_not_click() {
        let p = settled(&[(DRIFT, 0.0)]);
        let mut v = SubVoice::new(SR);
        let mut rng = Rng::new(1);
        v.trigger(1.0, 41, &p, &mut rng);
        let mut out = render(&mut v, &p, 9_600);
        v.trigger(1.0, 41, &p, &mut rng);
        out.extend(render(&mut v, &p, 2_400));
        let worst = out.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0_f32, f32::max);
        assert!(worst < 0.02, "max step {worst}");
    }

    #[test]
    fn glide_slides_between_notes() {
        let p = settled(&[(GLIDE, 1.0)]);
        let mut v = SubVoice::new(SR);
        let mut rng = Rng::new(1);
        v.trigger(1.0, 41, &p, &mut rng);
        render(&mut v, &p, 4_800);
        v.trigger(1.0, 53, &p, &mut rng);
        render(&mut v, &p, 1);
        assert!(v.pitch() < 42.0);
        render(&mut v, &p, 96_000);
        assert!((v.pitch() - 53.0).abs() < 0.05);
    }

    #[test]
    fn route_flag_switches_to_direct() {
        assert!(is_direct(&settled(&[(ROUTE, 1.0)])));
    }

    #[test]
    fn decays_and_deactivates() {
        let p = settled(&[(DECAY, 0.0)]);
        let mut v = SubVoice::new(SR);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        render(&mut v, &p, 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..SUB_PARAM_COUNT).map(|i| (i, norm)).collect();
            let p = settled(&edits);
            let mut v = SubVoice::new(SR);
            v.trigger(1.0, 127, &p, &mut Rng::new(3));
            assert!(render(&mut v, &p, 48_000).iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        }
    }
}
