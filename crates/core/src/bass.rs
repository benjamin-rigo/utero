use core::f32::consts::TAU;

use crate::bus::fader_gain;
use crate::dsp::{fold, midi_to_hz, Drive2x, Glide, Osc, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};
use crate::rng::Rng;

pub const SUB: usize = 0;
pub const CHAR: usize = 1;
pub const BRIGHT: usize = 2;
pub const PLUCK: usize = 3;
pub const GRIT: usize = 4;
pub const DECAY: usize = 5;
pub const GLIDE: usize = 6;
pub const LEVEL: usize = 7;
/// Switch, not a knob: 0, 1 or 2 octaves under the step note.
pub const SUB_OCT: usize = 8;
pub const BASS_PARAM_COUNT: usize = 9;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const BASS_PARAMS: [ParamDesc; BASS_PARAM_COUNT] = [
    ParamDesc { name: "SUB", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
    ParamDesc { name: "CHAR", min: 0.0, max: 1.0, default_norm: 0.35, curve: Curve::Lin },
    ParamDesc { name: "BRIGHT", min: 40.0, max: 12_000.0, default_norm: 0.45, curve: Curve::Exp },
    ParamDesc { name: "PLUCK", min: 0.0, max: 1.0, default_norm: 0.4, curve: Curve::Lin },
    ParamDesc { name: "GRIT", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "DECAY", min: 30.0, max: 4000.0, default_norm: 0.5, curve: Curve::Exp },
    ParamDesc { name: "GLIDE", min: 0.0, max: 300.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
    ParamDesc { name: "SUB OCT", min: 0.0, max: 2.0, default_norm: 0.5, curve: Curve::Lin },
];

const XOVER_HZ: f32 = 90.0;
const REESE_CENTS: f32 = 25.0;

pub fn bass_params(sample_rate: f32) -> ParamBank {
    ParamBank::new(&BASS_PARAMS, sample_rate)
}

fn smoothstep(x: f32) -> f32 {
    let t = x.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Pure-Sub-style bass: clean sine sub added after all processing, plus an upper layer
/// (PRESSURE → REESE) that is high-passed, filtered, gritted and noise-modulated.
pub struct BassVoice {
    sample_rate: f32,
    sub_phase: f32,
    osc_a: Osc,
    osc_b: Osc,
    xover: Svf,
    filter: Svf,
    drive: Drive2x,
    glide: Glide,
    amp: f32,
    attack: bool,
    att_coef: f32,
    fenv: f32,
    active: bool,
    vel: f32,
    noise_lp: f32,
    rng: Rng,
}

impl BassVoice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        BassVoice {
            sample_rate,
            sub_phase: 0.0,
            osc_a: Osc::new(),
            osc_b: Osc::new(),
            xover: Svf::new(),
            filter: Svf::new(),
            drive: Drive2x::new(),
            glide: Glide::new(41.0),
            amp: 0.0,
            attack: false,
            att_coef: 1.0 - (-1.0 / (0.002 * sample_rate)).exp(),
            fenv: 0.0,
            active: false,
            vel: 0.0,
            noise_lp: 0.0,
            rng: Rng::new(seed),
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
        // Reset phases only from (near) silence: resetting even a quiet tail would click.
        if !self.active || self.amp < 1.0e-3 {
            self.sub_phase = 0.0;
            self.osc_a.reset(0.0);
            self.osc_b.reset(rng.next_f32());
            self.xover.reset();
            self.filter.reset();
        }
        self.attack = true;
        self.fenv = 1.0;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
    }

    pub fn render(&mut self, p: &ParamBank) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        let grit = p.get(GRIT);
        let dirt = (grit * 2.0).min(1.0); // first half: tape drive
        let noise_amt = ((grit - 0.5) * 2.0).max(0.0); // second half: noise AM, jitter, fold

        let n = self.rng.bipolar();
        self.noise_lp += (n - self.noise_lp) * 0.05;
        self.glide.set_time(p.get(GLIDE), sr);
        let semis = self.glide.next() + self.noise_lp * noise_amt * 0.15;
        let freq = midi_to_hz(semis);

        // clean sine sub, never processed
        let sub_freq = midi_to_hz(semis - 12.0 * p.get(SUB_OCT).round());
        self.sub_phase += sub_freq / sr;
        if self.sub_phase >= 1.0 {
            self.sub_phase -= 1.0;
        }
        let sub = (self.sub_phase * TAU).sin() * fader_gain(p.get(SUB));

        // CHAR: 0–0.15 fades the layer in, up to 0.5 saw → saw+square (PRESSURE), above 0.5 detune opens (REESE)
        let c = p.get(CHAR);
        let layer_gain = smoothstep(c / 0.15);
        let square = (c / 0.5).min(1.0) * 0.5;
        let spread = ((((c - 0.5) * 2.0).max(0.0) * REESE_CENTS) / 2400.0).exp2();
        let (sa, pa) = self.osc_a.next(freq / spread, sr, 0.5);
        let (sb, pb) = self.osc_b.next(freq * spread, sr, 0.5);
        let reese = ((c - 0.5) * 2.0).clamp(0.0, 1.0);
        let va = sa + (pa - sa) * square;
        let vb = sb + (pb - sb) * square;
        let mut x = (va + vb * reese) / (1.0 + reese) * layer_gain;

        x *= 1.0 + noise_amt * self.noise_lp * 3.0;
        x = fold(x.clamp(-1.0, 1.0), noise_amt * 0.6);
        x = self.xover.process(x, XOVER_HZ, 1.414, sr).hp;

        let bright = p.get(BRIGHT);
        let pluck = p.get(PLUCK);
        let key = (semis - 41.0) / 12.0 * 0.5;
        let cutoff = (bright * (pluck * 4.0 * self.fenv + key).exp2()).clamp(20.0, 18_000.0);
        let norm_bright = BASS_PARAMS[BRIGHT].norm_of(bright);
        let damp = 1.8 - 1.0 * norm_bright;
        let filtered = self.filter.process(x, cutoff, damp, sr).lp;
        let upper = self.drive.process(filtered.clamp(-4.0, 4.0), dirt);

        let out = ((upper + sub) * self.amp * self.vel * fader_gain(p.get(LEVEL))).clamp(-1.0, 1.0);

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
        let f_decay_ms = 400.0 - 360.0 * pluck;
        self.fenv *= (-1.0 / (f_decay_ms * 0.001 * sr)).exp();

        if out.is_finite() {
            out
        } else {
            self.xover.reset();
            self.filter.reset();
            self.drive = Drive2x::new();
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn settled(edits: &[(usize, f32)]) -> ParamBank {
        let mut p = bass_params(SR);
        for &(i, v) in edits {
            p.set_norm(i, v);
        }
        for _ in 0..48_000 {
            p.advance();
        }
        p
    }

    fn render(v: &mut BassVoice, p: &ParamBank, n: usize) -> Vec<f32> {
        (0..n).map(|_| v.render(p)).collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn silent_until_triggered() {
        let p = settled(&[]);
        let mut v = BassVoice::new(SR, 1);
        assert!(render(&mut v, &p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn sub_alone_plays_f1_for_note_41() {
        let p = settled(&[(CHAR, 0.0), (GRIT, 0.0)]);
        let mut v = BassVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        let out = render(&mut v, &p, 48_000);
        let crossings = out.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert!((43..=44).contains(&crossings), "{crossings}");
    }

    #[test]
    fn sub_oct_moves_the_sub_down() {
        let count = |oct: f32| {
            let p = settled(&[(CHAR, 0.0), (GRIT, 0.0), (SUB_OCT, oct)]);
            let mut v = BassVoice::new(SR, 1);
            v.trigger(1.0, 53, &p, &mut Rng::new(1));
            render(&mut v, &p, 48_000).windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count()
        };
        let (zero, two) = (count(0.0), count(1.0));
        assert!((zero as f32 / two as f32 - 4.0).abs() < 0.2, "{zero} vs {two}");
    }

    #[test]
    fn char_adds_the_upper_layer() {
        let level = |c: f32| {
            let p = settled(&[(SUB, 0.0), (CHAR, c)]);
            let mut v = BassVoice::new(SR, 1);
            v.trigger(1.0, 41, &p, &mut Rng::new(1));
            rms(&render(&mut v, &p, 9_600))
        };
        assert!(level(0.0) < 1e-4);
        assert!(level(0.5) > 0.02);
    }

    #[test]
    fn sub_level_zero_is_silent_without_char() {
        let p = settled(&[(SUB, 0.0), (CHAR, 0.0)]);
        let mut v = BassVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        assert!(rms(&render(&mut v, &p, 4_800)) < 1e-4);
    }

    #[test]
    fn retrigger_while_sounding_does_not_click() {
        let p = settled(&[(CHAR, 0.0), (GRIT, 0.0)]);
        let mut v = BassVoice::new(SR, 1);
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
        let mut v = BassVoice::new(SR, 1);
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
    fn decays_and_deactivates() {
        let p = settled(&[(DECAY, 0.0)]);
        let mut v = BassVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        render(&mut v, &p, 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite_and_bounded() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..BASS_PARAM_COUNT).map(|i| (i, norm)).collect();
            let p = settled(&edits);
            let mut v = BassVoice::new(SR, 7);
            v.trigger(1.0, 100, &p, &mut Rng::new(3));
            assert!(render(&mut v, &p, 48_000).iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        }
    }
}
