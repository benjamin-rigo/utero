use crate::dsp::{fold, midi_to_hz, Drive2x, Glide, Osc, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};
use crate::rng::Rng;

pub const WAVE: usize = 0;
pub const DETUNE: usize = 1;
pub const FOLD: usize = 2;
pub const NOISE: usize = 3;
pub const DRIFT: usize = 4;
pub const OCT: usize = 5;
pub const GLIDE: usize = 6;
pub const LINK: usize = 7;
pub const CUTOFF: usize = 8;
pub const RES: usize = 9;
pub const ENV_AMT: usize = 10;
pub const F_DECAY: usize = 11;
pub const DRIVE: usize = 12;
pub const KEYTRK: usize = 13;
pub const TYPE: usize = 14;
pub const LEVEL: usize = 15;
pub const A_DECAY: usize = 16;
pub const MID_PARAM_COUNT: usize = 17;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const MID_PARAMS: [ParamDesc; MID_PARAM_COUNT] = [
    // saw ↔ pulse
    ParamDesc { name: "WAVE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    // second oscillator detune in cents (Reese)
    ParamDesc { name: "DETUNE", min: 0.0, max: 30.0, default_norm: 0.3, curve: Curve::Lin },
    ParamDesc { name: "FOLD", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "NOISE", min: 0.0, max: 1.0, default_norm: 0.05, curve: Curve::Lin },
    ParamDesc { name: "DRIFT", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    // −1, 0 or +1 octave
    ParamDesc { name: "OCT", min: 0.0, max: 2.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "GLIDE", min: 0.0, max: 300.0, default_norm: 0.0, curve: Curve::Lin },
    // ≥ 0.5: play SUB's notes instead of MID's own steps
    ParamDesc { name: "LINK", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "CUTOFF", min: 30.0, max: 12_000.0, default_norm: 0.45, curve: Curve::Exp },
    ParamDesc { name: "RES", min: 0.0, max: 1.0, default_norm: 0.3, curve: Curve::Lin },
    // filter envelope depth in octaves
    ParamDesc { name: "ENV AMT", min: 0.0, max: 4.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "F.DECAY", min: 10.0, max: 2000.0, default_norm: 0.4, curve: Curve::Exp },
    ParamDesc { name: "DRIVE", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "KEYTRK", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    // < 0.5 low-pass, ≥ 0.5 band-pass
    ParamDesc { name: "TYPE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.7, curve: Curve::Lin },
    ParamDesc { name: "A.DECAY", min: 30.0, max: 4000.0, default_norm: 0.5, curve: Curve::Exp },
];

pub fn mid_params(sample_rate: f32) -> ParamBank {
    ParamBank::new(&MID_PARAMS, sample_rate)
}

pub fn is_linked(p: &ParamBank) -> bool {
    p.get(LINK) >= 0.5
}

/// Two detuned polyBLEP oscillators → noise AM → fold → TPT filter with envelope → drive.
pub struct MidVoice {
    sample_rate: f32,
    osc_a: Osc,
    osc_b: Osc,
    svf: Svf,
    glide: Glide,
    amp: f32,
    attack: bool,
    att_coef: f32,
    fenv: f32,
    active: bool,
    vel: f32,
    drift: f32,
    noise_lp: f32,
    drive: Drive2x,
    rng: Rng,
}

impl MidVoice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        MidVoice {
            sample_rate,
            osc_a: Osc::new(),
            osc_b: Osc::new(),
            svf: Svf::new(),
            glide: Glide::new(41.0),
            amp: 0.0,
            attack: false,
            att_coef: 1.0 - (-1.0 / (0.001 * sample_rate)).exp(),
            fenv: 0.0,
            active: false,
            vel: 0.0,
            drift: 0.0,
            noise_lp: 0.0,
            drive: Drive2x::new(),
            rng: Rng::new(seed),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn trigger(&mut self, vel: f32, note: u8, p: &ParamBank, rng: &mut Rng) {
        let sounding = self.active && self.amp > 0.05;
        if sounding && p.get(GLIDE) > 0.0 {
            self.glide.set_target(note as f32);
        } else {
            self.glide.jump(note as f32);
        }
        if !sounding {
            self.osc_a.reset(0.0);
            self.osc_b.reset(rng.next_f32());
            self.svf.reset();
        }
        self.attack = true;
        self.fenv = 1.0;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
        self.drift = rng.bipolar() * 0.01 * p.get(DRIFT);
    }

    pub fn render(&mut self, p: &ParamBank) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        self.glide.set_time(p.get(GLIDE), sr);
        let semis = self.glide.next() + 12.0 * (p.get(OCT).round() - 1.0);
        let base = midi_to_hz(semis) * (1.0 + self.drift);
        let spread = (p.get(DETUNE) / 2400.0).exp2(); // half the detune each way
        let (sa, pa) = self.osc_a.next(base / spread, sr, 0.5);
        let (sb, pb) = self.osc_b.next(base * spread, sr, 0.5);
        let w = p.get(WAVE);
        let va = sa + (pa - sa) * w;
        let vb = sb + (pb - sb) * w;
        let d = (p.get(DETUNE) / 30.0).min(1.0);
        let mut x = (va + vb * d) / (1.0 + d);

        // NOISE modulates the amplitude, so the texture moves with the note instead of sitting beside it.
        let n = self.rng.bipolar();
        self.noise_lp += (n - self.noise_lp) * 0.05;
        let nz = p.get(NOISE);
        x *= 1.0 + nz * self.noise_lp * 3.0;
        x += n * nz * 0.05;
        x = fold(x.clamp(-1.0, 1.0), p.get(FOLD));

        let key = p.get(KEYTRK) * (semis - 41.0) / 12.0;
        let cutoff = (p.get(CUTOFF) * (p.get(ENV_AMT) * self.fenv + key).exp2()).clamp(20.0, 18_000.0);
        let f = self.svf.process(x, cutoff, 2.0 - 1.9 * p.get(RES), sr);
        let filtered = if p.get(TYPE) < 0.5 { f.lp } else { f.bp * 1.5 };
        let y = self.drive.process(filtered.clamp(-4.0, 4.0), p.get(DRIVE));
        let out = (y * self.amp * self.vel * p.get(LEVEL)).clamp(-1.0, 1.0);

        if self.attack {
            self.amp += (1.0 - self.amp) * self.att_coef;
            if self.amp > 0.999 {
                self.attack = false;
            }
        } else {
            self.amp *= (-1.0 / (p.get(A_DECAY) * 0.001 * sr)).exp();
            if self.amp < 1.0e-4 {
                self.active = false;
            }
        }
        self.fenv *= (-1.0 / (p.get(F_DECAY) * 0.001 * sr)).exp();
        if out.is_finite() {
            out
        } else {
            self.svf.reset();
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
        let mut p = mid_params(SR);
        for &(i, v) in edits {
            p.set_norm(i, v);
        }
        for _ in 0..48_000 {
            p.advance();
        }
        p
    }

    fn render(v: &mut MidVoice, p: &ParamBank, n: usize) -> Vec<f32> {
        (0..n).map(|_| v.render(p)).collect()
    }

    #[test]
    fn defaults() {
        let p = mid_params(SR);
        assert!((p.get(CUTOFF) - 446.0).abs() < 3.0);
        assert!((p.get(A_DECAY) - 346.0).abs() < 3.0);
        assert!(!is_linked(&p));
    }

    #[test]
    fn silent_until_triggered() {
        let p = settled(&[]);
        let mut v = MidVoice::new(SR, 1);
        assert!(render(&mut v, &p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn a_note_is_audible_and_bounded() {
        let p = settled(&[]);
        let mut v = MidVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(2));
        let out = render(&mut v, &p, 24_000);
        assert!(out.iter().fold(0.0_f32, |m, s| m.max(s.abs())) > 0.05);
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }

    #[test]
    fn filter_envelope_brightens_the_attack() {
        let roughness = |env: f32| {
            let p = settled(&[(ENV_AMT, env), (DETUNE, 0.0), (NOISE, 0.0), (DRIFT, 0.0)]);
            let mut v = MidVoice::new(SR, 1);
            v.trigger(1.0, 41, &p, &mut Rng::new(2));
            let out = render(&mut v, &p, 960);
            out.windows(3).map(|w| (w[2] - 2.0 * w[1] + w[0]).abs()).sum::<f32>()
        };
        assert!(roughness(1.0) > roughness(0.0) * 1.5);
    }

    #[test]
    fn cutoff_modulation_stays_finite() {
        let mut p = settled(&[(RES, 1.0)]);
        let mut v = MidVoice::new(SR, 1);
        let mut rng = Rng::new(5);
        v.trigger(1.0, 41, &p, &mut rng);
        for _ in 0..48_000 {
            p.set_norm(CUTOFF, rng.next_f32());
            p.advance();
            assert!(v.render(&p).is_finite());
        }
    }

    #[test]
    fn decays_and_deactivates() {
        let p = settled(&[(A_DECAY, 0.0)]);
        let mut v = MidVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        render(&mut v, &p, 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..MID_PARAM_COUNT).map(|i| (i, norm)).collect();
            let p = settled(&edits);
            let mut v = MidVoice::new(SR, 7);
            v.trigger(1.0, 100, &p, &mut Rng::new(3));
            assert!(render(&mut v, &p, 48_000).iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        }
    }
}


