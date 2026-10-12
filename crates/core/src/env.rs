use crate::params::{Curve, ParamDesc};

/// Envelope params, shared by every machine's amp section (row indices `ENV_BASE..ENV_BASE + 5`)
/// and by the ENV modulator. Mirrored in web/src/state/machines.ts.
pub const ENV_BASE: usize = 10;
pub const ATK: usize = 0;
pub const HOLD: usize = 1;
pub const DEC: usize = 2;
pub const SUS: usize = 3;
pub const REL: usize = 4;
pub const ENV_COUNT: usize = 5;

pub const fn env_desc(i: usize, default_norm: f32) -> ParamDesc {
    match i {
        ATK => ParamDesc { name: "ATK", min: 0.5, max: 4_000.0, default_norm, curve: Curve::Exp },
        HOLD => ParamDesc { name: "HOLD", min: 0.5, max: 4_000.0, default_norm, curve: Curve::Exp },
        DEC => ParamDesc { name: "DEC", min: 1.0, max: 8_000.0, default_norm, curve: Curve::Exp },
        SUS => ParamDesc { name: "SUS", min: 0.0, max: 1.0, default_norm, curve: Curve::Lin },
        _ => ParamDesc { name: "REL", min: 1.0, max: 8_000.0, default_norm, curve: Curve::Exp },
    }
}

/// Mapped envelope settings: times in ms, sustain 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EnvTimes {
    pub attack_ms: f32,
    pub hold_ms: f32,
    pub decay_ms: f32,
    pub sustain: f32,
    pub release_ms: f32,
}

impl EnvTimes {
    /// Reads a machine row's amp envelope (already mapped to ms by the bank).
    pub fn from_bank(p: &crate::params::ParamBank) -> Self {
        let g = |i: usize| p.get(ENV_BASE + i);
        EnvTimes { attack_ms: g(ATK), hold_ms: g(HOLD), decay_ms: g(DEC), sustain: g(SUS), release_ms: g(REL) }
    }

    pub fn from_norms(n: [f32; ENV_COUNT]) -> Self {
        let m = |i: usize| env_desc(i, 0.0).map(n[i]);
        EnvTimes { attack_ms: m(ATK), hold_ms: m(HOLD), decay_ms: m(DEC), sustain: m(SUS), release_ms: m(REL) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Idle,
    Attack,
    Hold,
    Decay,
    Release,
}

const K: f32 = 5.0;

/// How far below its target an exponential stage aims, so that with a constant time it lands on the
/// target exactly when the stage ends (the normalised curve `(e^{-Kp} − e^{-K}) / (1 − e^{-K})`).
fn undershoot(span: f32) -> f32 {
    let end = (-K).exp();
    span * end / (1.0 - end)
}

/// AHDSR without a gate (steps have no length): attack → hold at peak → decay to SUS → release to 0.
/// Stages step recursively towards their target, so modulating a time bends the curve but the level
/// never jumps or rises while falling.
#[derive(Clone, Copy, Debug)]
pub struct Ahdsr {
    stage: Stage,
    /// Samples spent in the hold stage.
    t: f32,
    /// Level the current stage started from.
    from: f32,
    level: f32,
}

impl Default for Ahdsr {
    fn default() -> Self {
        Ahdsr { stage: Stage::Idle, t: 0.0, from: 0.0, level: 0.0 }
    }
}

impl Ahdsr {
    /// Restarts from the current level, so a retrigger mid-tail never jumps.
    pub fn trigger(&mut self) {
        self.stage = Stage::Attack;
        self.t = 0.0;
        self.from = self.level;
    }

    /// Starts from silence (identical, phase-locked hits: the kick).
    pub fn restart(&mut self) {
        self.level = 0.0;
        self.trigger();
    }

    pub fn level(&self) -> f32 {
        self.level
    }

    pub fn is_idle(&self) -> bool {
        self.stage == Stage::Idle
    }

    fn enter(&mut self, stage: Stage) {
        self.stage = stage;
        self.t = 0.0;
        self.from = self.level;
    }

    pub fn next(&mut self, e: &EnvTimes, sample_rate: f32) -> f32 {
        let len = |ms: f32| (ms * 0.001 * sample_rate).max(1.0);
        let s = e.sustain.clamp(0.0, 1.0);
        match self.stage {
            Stage::Idle => return 0.0,
            Stage::Attack => {
                self.level = (self.level + (1.0 - self.from).max(1.0e-6) / len(e.attack_ms)).min(1.0);
                if self.level >= 1.0 {
                    self.enter(Stage::Hold);
                }
            }
            Stage::Hold => {
                self.level = 1.0;
                self.t += 1.0;
                if self.t >= len(e.hold_ms) {
                    self.enter(Stage::Decay);
                }
            }
            Stage::Decay => {
                let aim = s - undershoot(self.from - s);
                self.level = (aim + (self.level - aim) * (-K / len(e.decay_ms)).exp()).max(s);
                if self.level <= s {
                    self.enter(Stage::Release);
                }
            }
            Stage::Release => {
                let aim = -undershoot(self.from);
                self.level = (aim + (self.level - aim) * (-K / len(e.release_ms)).exp()).max(0.0);
                if self.level <= 0.0 {
                    self.enter(Stage::Idle);
                }
            }
        }
        self.level
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const E: EnvTimes = EnvTimes { attack_ms: 10.0, hold_ms: 20.0, decay_ms: 100.0, sustain: 0.5, release_ms: 200.0 };

    fn run(env: &mut Ahdsr, n: usize) -> Vec<f32> {
        (0..n).map(|_| env.next(&E, SR)).collect()
    }

    #[test]
    fn stages_follow_their_times_and_end_exactly() {
        let mut env = Ahdsr::default();
        env.trigger();
        let out = run(&mut env, 20_000);
        assert!((out[479] - 1.0).abs() < 1e-3, "attack ends at 10 ms: {}", out[479]);
        assert_eq!(out[480 + 500], 1.0, "hold");
        let d0 = 480 + 960;
        assert!((out[d0 + 2_400] - (0.5 + 0.5 * (-2.5f32).exp())).abs() < 0.02, "decay shape: {}", out[d0 + 2_400]);
        assert!((out[d0 + 4_799] - 0.5).abs() < 2e-3, "decay lands on SUS: {}", out[d0 + 4_799]);
        assert!(out[d0 + 4_800 + 9_600] < 1e-3);
        assert!(env.is_idle());
        assert_eq!(out[19_999], 0.0);
    }

    #[test]
    fn retrigger_mid_tail_does_not_jump() {
        let mut env = Ahdsr::default();
        env.trigger();
        let mut out = run(&mut env, 8_000);
        env.trigger();
        out.extend(run(&mut env, 100));
        let worst = out.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        assert!(worst < 0.01, "{worst}");
    }

    #[test]
    fn modulating_decay_never_makes_it_rise() {
        let mut env = Ahdsr::default();
        env.trigger();
        let mut prev = 1.0;
        for i in 0..24_000 {
            let e = EnvTimes { decay_ms: if (i / 1000) % 2 == 0 { 50.0 } else { 3_000.0 }, ..E };
            let v = env.next(&e, SR);
            if i > 1_440 {
                assert!(v <= prev + 1e-7, "rose at {i}: {prev} -> {v}");
            }
            prev = v;
        }
    }

    #[test]
    fn idle_until_triggered() {
        let mut env = Ahdsr::default();
        assert!(run(&mut env, 10).iter().all(|&v| v == 0.0));
    }

    #[test]
    fn norms_map_through_the_descs() {
        let t = EnvTimes::from_norms([0.0, 0.0, 1.0, 0.25, 1.0]);
        assert_eq!((t.attack_ms, t.decay_ms, t.sustain, t.release_ms), (0.5, 8_000.0, 0.25, 8_000.0));
    }
}
