use core::f32::consts::TAU;

use crate::dsp::{one_pole_coef, Drive2x, Smoother};
use crate::params::{Curve, ParamDesc};
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

pub struct KickParams {
    smooth: [Smoother; KICK_PARAM_COUNT],
    values: [f32; KICK_PARAM_COUNT],
}

impl KickParams {
    pub fn new(sample_rate: f32) -> Self {
        let smooth: [Smoother; KICK_PARAM_COUNT] = core::array::from_fn(|i| {
            let d = KICK_PARAMS[i];
            Smoother::new(d.map(d.default_norm), 10.0, sample_rate)
        });
        let values = core::array::from_fn(|i| smooth[i].value());
        KickParams { smooth, values }
    }

    pub fn set_norm(&mut self, i: usize, norm: f32) {
        if let (Some(s), Some(d)) = (self.smooth.get_mut(i), KICK_PARAMS.get(i)) {
            s.set(d.map(norm));
        }
    }

    pub fn advance(&mut self) {
        for i in 0..KICK_PARAM_COUNT {
            self.values[i] = self.smooth[i].next();
        }
    }

    pub fn get(&self, i: usize) -> f32 {
        self.values[i]
    }
}

pub struct KickVoice {
    sample_rate: f32,
    phase: f32,
    t: u32,
    active: bool,
    vel: f32,
    drift: f32,
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
            lp: 0.0,
            drive: Drive2x::new(),
            rng: Rng::new(seed),
        }
    }

    pub fn trigger(&mut self, vel: f32, rng: &mut Rng) {
        self.t = 0;
        self.phase = 0.0;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
        // ±1% pitch per hit: no two kicks are identical, like an analog circuit.
        self.drift = rng.bipolar() * 0.01;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn render(&mut self, p: &KickParams) -> f32 {
        if !self.active {
            return 0.0;
        }
        let ts = self.t as f32 / self.sample_rate;
        let noise = self.rng.bipolar();
        let nz = p.get(NOISE);

        // NOISE both adds a layer and micro-modulates pitch and amplitude.
        let pitch_env = (-ts / (p.get(STIME) * 0.001)).exp();
        let semis = p.get(SWEEP) * pitch_env;
        let freq = p.get(TUNE) * (1.0 + self.drift) * (semis / 12.0).exp2() * (1.0 + noise * nz * 0.02);
        self.phase += freq / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let amp = (-ts / (p.get(DECAY) * 0.001)).exp();
        let body = (self.phase * TAU).sin() * amp * (1.0 + noise * nz * 0.3);
        let impulse = if self.t == 0 { 1.0 } else { 0.0 };
        let click = (impulse + noise * 0.6) * (-ts / 0.002).exp() * p.get(CLICK);
        let layer = noise * nz * 0.15 * amp;

        let x = self.drive.process(body + click + layer, p.get(DRIVE));
        self.lp += (x - self.lp) * one_pole_coef(p.get(TONE), self.sample_rate);

        self.t = self.t.saturating_add(1);
        if amp < 1.0e-4 && ts > 0.01 {
            self.active = false;
        }
        self.lp * self.vel * p.get(LEVEL)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let p = KickParams::new(SR);
        assert!((p.get(TUNE) - 45.0).abs() < 0.5, "{}", p.get(TUNE));
    }

    #[test]
    fn silent_until_triggered() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = KickParams::new(SR);
        assert!(render(&mut v, &mut p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn trigger_produces_decaying_sound() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = KickParams::new(SR);
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
        let mut p = KickParams::new(SR);
        v.trigger(1.0, &mut Rng::new(3));
        render(&mut v, &mut p, 4 * 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let mut p = KickParams::new(SR);
            for i in 0..KICK_PARAM_COUNT {
                p.set_norm(i, norm);
            }
            let mut v = KickVoice::new(SR, 5);
            v.trigger(1.0, &mut Rng::new(3));
            assert!(render(&mut v, &mut p, 48_000).iter().all(|s| s.is_finite()));
        }
    }

    #[test]
    fn bad_param_index_is_ignored() {
        let mut p = KickParams::new(SR);
        p.set_norm(99, 0.5);
    }
}
