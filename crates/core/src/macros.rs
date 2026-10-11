use crate::dsp::Smoother;
use crate::modulation::ParamRef;

pub const MACROS: usize = 8;
pub const MACRO_TARGETS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MacroTarget {
    pub target: ParamRef,
    pub a: f32,
    pub b: f32,
}

/// Octatrack-style macros: each target is an absolute A→B pair the fader interpolates.
pub struct Macros {
    targets: [[Option<MacroTarget>; MACRO_TARGETS]; MACROS],
    pos: [Smoother; MACROS],
    current: [f32; MACROS],
}

impl Macros {
    pub fn new(sample_rate: f32) -> Self {
        Macros {
            targets: [[None; MACRO_TARGETS]; MACROS],
            pos: core::array::from_fn(|_| Smoother::new(0.0, 15.0, sample_rate)),
            current: [0.0; MACROS],
        }
    }

    pub fn set_target(&mut self, m: usize, i: usize, t: MacroTarget) {
        if !(t.a.is_finite() && t.b.is_finite()) {
            return;
        }
        if let Some(slot) = self.targets.get_mut(m).and_then(|row| row.get_mut(i)) {
            *slot = Some(MacroTarget { a: t.a.clamp(0.0, 1.0), b: t.b.clamp(0.0, 1.0), ..t });
        }
    }

    pub fn clear_target(&mut self, m: usize, i: usize) {
        if let Some(slot) = self.targets.get_mut(m).and_then(|row| row.get_mut(i)) {
            *slot = None;
        }
    }

    pub fn set_pos(&mut self, m: usize, pos: f32) {
        if let (Some(s), true) = (self.pos.get_mut(m), pos.is_finite()) {
            s.set(pos.clamp(0.0, 1.0));
        }
    }

    pub fn advance(&mut self) {
        for i in 0..MACROS {
            self.current[i] = self.pos[i].next();
        }
    }

    /// Overrides base norms of `track` with each target's A→B value; later macros win on shared targets.
    pub fn apply(&self, track: u8, norms: &mut [f32]) {
        for (m, row) in self.targets.iter().enumerate() {
            for t in row.iter().flatten() {
                if t.target.track != track {
                    continue;
                }
                if let Some(v) = norms.get_mut(t.target.param as usize) {
                    *v = t.a + (t.b - t.a) * self.current[m];
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn target(track: u8, param: u8, a: f32, b: f32) -> MacroTarget {
        MacroTarget { target: ParamRef { track, param }, a, b }
    }

    fn settle(m: &mut Macros) {
        for _ in 0..48_000 {
            m.advance();
        }
    }

    #[test]
    fn no_targets_leave_values_alone() {
        let m = Macros::new(SR);
        let mut v = [0.3_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v, [0.3; 9]);
    }

    #[test]
    fn interpolates_between_a_and_b() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 2, 0.2, 0.8));
        m.set_pos(0, 0.5);
        settle(&mut m);
        let mut v = [0.0_f32; 9];
        m.apply(0, &mut v);
        assert!((v[2] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn position_is_smoothed() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, 0.0, 1.0));
        m.set_pos(0, 1.0);
        m.advance();
        let mut v = [0.0_f32; 9];
        m.apply(0, &mut v);
        assert!(v[0] < 0.1, "{}", v[0]);
    }

    #[test]
    fn other_tracks_are_untouched() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(1, 0, 0.9, 0.9));
        settle(&mut m);
        let mut v = [0.1_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v[0], 0.1);
    }

    #[test]
    fn later_macro_wins_on_shared_target() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 4, 0.1, 0.1));
        m.set_target(3, 0, target(0, 4, 0.7, 0.7));
        settle(&mut m);
        let mut v = [0.0_f32; 9];
        m.apply(0, &mut v);
        assert!((v[4] - 0.7).abs() < 1e-6);
    }

    #[test]
    fn cleared_target_stops_overriding() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 1, 0.9, 0.9));
        m.clear_target(0, 0);
        let mut v = [0.2_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v[1], 0.2);
    }

    #[test]
    fn invalid_input_is_ignored() {
        let mut m = Macros::new(SR);
        m.set_target(9, 0, target(0, 0, 0.5, 0.5));
        m.set_target(0, 99, target(0, 0, 0.5, 0.5));
        m.set_target(0, 0, target(0, 0, f32::NAN, 0.5));
        m.set_target(0, 1, target(0, 200, 0.5, 0.5));
        m.set_pos(0, f32::NAN);
        m.set_pos(42, 1.0);
        m.clear_target(99, 99);
        settle(&mut m);
        let mut v = [0.2_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v, [0.2; 9]);
    }

    #[test]
    fn endpoints_are_clamped() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, -2.0, 3.0));
        m.set_pos(0, 1.0);
        settle(&mut m);
        let mut v = [0.5_f32; 9];
        m.apply(0, &mut v);
        assert!((v[0] - 1.0).abs() < 1e-3);
    }
}
