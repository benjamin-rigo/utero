use core::f32::consts::TAU;

use crate::dsp::{one_pole_coef, Drive2x};
use crate::params::{Curve, ParamBank, ParamDesc};
use crate::rng::Rng;

pub const TUNE: usize = 0;
pub const SWEEP: usize = 1;
pub const STIME: usize = 2;
pub const DECAY: usize = 3;
pub const CLICK: usize = 4;
pub const DRIVE: usize = 5;
pub const NOISE: usize = 6;
pub const TONE: usize = 7;
pub const LEVEL: usize = 8;
pub const KICK_PARAM_COUNT: usize = 9;

/// Order and default_norm are mirrored in web/src/state/kickParams.ts.
pub const KICK_PARAMS: [ParamDesc; KICK_PARAM_COUNT] = [
    ParamDesc { name: "TUNE", min: 30.0, max: 120.0, default_norm: 0.2925, curve: Curve::Exp },
    ParamDesc { name: "SWEEP", min: 0.0, max: 48.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "S.TIME", min: 5.0, max: 300.0, default_norm: 0.508, curve: Curve::Exp },
    ParamDesc { name: "DECAY", min: 50.0, max: 2000.0, default_norm: 0.5637, curve: Curve::Exp },
    ParamDesc { name: "CLICK", min: 0.0, max: 1.0, default_norm: 0.3, curve: Curve::Lin },
    ParamDesc { name: "DRIVE", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "NOISE", min: 0.0, max: 1.0, default_norm: 0.05, curve: Curve::Lin },
    ParamDesc { name: "TONE", min: 200.0, max: 12_000.0, default_norm: 0.8, curve: Curve::Exp },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
];

pub type KickParams = ParamBank;

pub fn kick_params(sample_rate: f32) -> KickParams {
    ParamBank::new(&KICK_PARAMS, sample_rate)
}

pub struct KickVoice {
    sample_rate: f32,
    phase: f32,
    t: u32,
    active: bool,
    vel: f32,
    drift: f32,
    amp: f32,
    pitch_env: f32,
    click_env: f32,
    click_coef: f32,
    lp: f32,
    drive: Drive2x,
    rng: Rng,
}

impl KickVoice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        KickVoice {
            sample_rate,
            phase: 0.0,
            t: 0,
            active: false,
            vel: 0.0,
            drift: 0.0,
            amp: 0.0,
            pitch_env: 0.0,
            click_env: 0.0,
            click_coef: (-1.0 / (0.002 * sample_rate)).exp(),
            lp: 0.0,
            drive: Drive2x::new(),
            rng: Rng::new(seed),
        }
    }

    pub fn trigger(&mut self, vel: f32, rng: &mut Rng) {
        self.t = 0;
        self.phase = 0.0;
        self.active = true;
        self.amp = 1.0;
        self.pitch_env = 1.0;
        self.click_env = 1.0;
        self.lp = 0.0;
        self.drive = Drive2x::new();
        self.vel = vel.clamp(0.0, 1.0);
        // ±1% pitch per hit: no two kicks are identical, like an analog circuit.
        self.drift = rng.bipolar() * 0.01;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn envelope(&self) -> f32 {
        self.amp
    }

    pub fn render(&mut self, p: &KickParams) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        let noise = self.rng.bipolar();
        let nz = p.get(NOISE);

        // NOISE both adds a layer and micro-modulates pitch and amplitude.
        let semis = p.get(SWEEP) * self.pitch_env;
        let freq = p.get(TUNE) * (1.0 + self.drift) * (semis / 12.0).exp2() * (1.0 + noise * nz * 0.02);
        self.phase += freq / sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let body = (self.phase * TAU).sin() * self.amp * (1.0 + noise * nz * 0.3);
        let impulse = if self.t == 0 { 1.0 } else { 0.0 };
        let click = (impulse + noise * 0.6) * self.click_env * p.get(CLICK);
        let layer = noise * nz * 0.15 * self.amp;

        let x = self.drive.process(body + click + layer, p.get(DRIVE));
        self.lp += (x - self.lp) * one_pole_coef(p.get(TONE), sr);
        if !self.lp.is_finite() {
            self.lp = 0.0;
            self.drive = Drive2x::new();
        }
        let out = self.lp * self.vel * p.get(LEVEL);

        // Recursive envelopes: modulating DECAY/S.TIME bends the curve, never jumps or swells.
        self.amp *= (-1.0 / (p.get(DECAY) * 0.001 * sr)).exp();
        self.pitch_env *= (-1.0 / (p.get(STIME) * 0.001 * sr)).exp();
        self.click_env *= self.click_coef;
        self.t = self.t.saturating_add(1);
        if self.amp < 1.0e-4 && self.t as f32 > 0.01 * sr {
            self.active = false;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::MAX_PARAMS;

    const SR: f32 = 48_000.0;

    fn render(v: &mut KickVoice, p: &mut KickParams, n: usize) -> Vec<f32> {
        (0..n)
            .map(|_| {
                p.advance();
                v.render(p)
            })
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn default_tune_is_about_45_hz() {
        let p = kick_params(SR);
        assert!((p.get(TUNE) - 45.0).abs() < 0.5, "{}", p.get(TUNE));
    }

    #[test]
    fn silent_until_triggered() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = kick_params(SR);
        assert!(render(&mut v, &mut p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn trigger_produces_decaying_sound() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = kick_params(SR);
        v.trigger(1.0, &mut Rng::new(3));
        let out = render(&mut v, &mut p, 120_000);
        let head = &out[..4_800];
        let tail = &out[96_000..100_800];
        assert!(head.iter().fold(0.0_f32, |m, s| m.max(s.abs())) > 0.3);
        assert!(rms(tail) < rms(head) / 10.0);
    }

    #[test]
    fn voice_deactivates_after_decay() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = kick_params(SR);
        v.trigger(1.0, &mut Rng::new(3));
        render(&mut v, &mut p, 4 * 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let mut p = kick_params(SR);
            for i in 0..KICK_PARAM_COUNT {
                p.set_norm(i, norm);
            }
            let mut v = KickVoice::new(SR, 5);
            v.trigger(1.0, &mut Rng::new(3));
            assert!(render(&mut v, &mut p, 48_000).iter().all(|s| s.is_finite()));
        }
    }

    #[test]
    fn retrigger_resets_filter_and_drive_state() {
        let mut p = kick_params(SR);
        p.set_norm(NOISE, 0.0);
        p.set_norm(CLICK, 0.0);
        p.set_norm(DRIVE, 1.0);
        let mut used = KickVoice::new(SR, 1);
        used.trigger(1.0, &mut Rng::new(3));
        render(&mut used, &mut p, 48_000);
        used.trigger(1.0, &mut Rng::new(3));
        let mut fresh = KickVoice::new(SR, 1);
        fresh.trigger(1.0, &mut Rng::new(3));
        p.advance();
        assert_eq!(used.render(&p), fresh.render(&p));
    }

    #[test]
    fn bad_param_index_is_ignored() {
        let mut p = kick_params(SR);
        p.set_norm(99, 0.5);
    }

    #[test]
    fn apply_norms_maps_final_values() {
        let mut p = kick_params(SR);
        p.apply_norms(&[1.0; MAX_PARAMS]);
        assert_eq!(p.get(TUNE), 120.0);
        assert_eq!(p.get(DECAY), 2000.0);
        p.apply_norms(&[0.0; MAX_PARAMS]);
        assert_eq!(p.get(TUNE), 30.0);
    }

    #[test]
    fn next_norms_smooths_towards_base() {
        let mut p = kick_params(SR);
        p.set_norm(TUNE, 1.0);
        let first = p.next_norms()[TUNE];
        assert!(first > KICK_PARAMS[TUNE].default_norm && first < 0.4, "first {first}");
        for _ in 0..48_000 {
            p.next_norms();
        }
        assert!((p.next_norms()[TUNE] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn non_finite_norm_is_ignored() {
        let mut p = kick_params(SR);
        p.set_norm(TUNE, f32::NAN);
        for _ in 0..1000 {
            p.advance();
        }
        assert!((p.get(TUNE) - 45.0).abs() < 0.5);
    }

    #[test]
    fn amp_envelope_never_rises_when_decay_is_modulated() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = kick_params(SR);
        v.trigger(1.0, &mut Rng::new(3));
        let mut prev = v.envelope();
        for i in 0..24_000 {
            if i % 1000 == 0 {
                p.set_norm(DECAY, if (i / 1000) % 2 == 0 { 1.0 } else { 0.0 });
            }
            p.advance();
            v.render(&p);
            let e = v.envelope();
            assert!(e <= prev, "envelope rose at sample {i}: {prev} -> {e}");
            prev = e;
        }
    }
}
