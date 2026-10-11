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
    targets: [[Option<Slot>; MACRO_TARGETS]; MACROS],
    pos: [Smoother; MACROS],
    current: [f32; MACROS],
    coef: f32,
}

/// A target plus its click-free state: `value` glides to the A→B point, `weight` fades the override in/out.
#[derive(Clone, Copy)]
struct Slot {
    t: MacroTarget,
    value: f32,
    weight: f32,
    live: bool,
}

impl Slot {
    fn goal(&self, pos: f32) -> f32 {
        self.t.a + (self.t.b - self.t.a) * pos
    }
}

impl Macros {
    pub fn new(sample_rate: f32) -> Self {
        Macros {
            targets: [[None; MACRO_TARGETS]; MACROS],
            pos: core::array::from_fn(|_| Smoother::new(0.0, 15.0, sample_rate)),
            current: [0.0; MACROS],
            coef: 1.0 - (-1.0 / (0.010 * sample_rate)).exp(),
        }
    }

    pub fn set_target(&mut self, m: usize, i: usize, t: MacroTarget) {
        if !(t.a.is_finite() && t.b.is_finite()) {
            return;
        }
        let t = MacroTarget { a: t.a.clamp(0.0, 1.0), b: t.b.clamp(0.0, 1.0), ..t };
        let pos = self.current.get(m).copied().unwrap_or(0.0);
        if let Some(slot) = self.targets.get_mut(m).and_then(|row| row.get_mut(i)) {
            match slot {
                Some(s) => {
                    s.t = t;
                    s.live = true;
                }
                None => {
                    let mut s = Slot { t, value: 0.0, weight: 0.0, live: true };
                    s.value = s.goal(pos);
                    *slot = Some(s);
                }
            }
        }
    }

    pub fn clear_target(&mut self, m: usize, i: usize) {
        if let Some(Some(s)) = self.targets.get_mut(m).and_then(|row| row.get_mut(i)) {
            s.live = false;
        }
    }

    pub fn set_pos(&mut self, m: usize, pos: f32) {
        if let (Some(s), true) = (self.pos.get_mut(m), pos.is_finite()) {
            s.set(pos.clamp(0.0, 1.0));
        }
    }

    pub fn advance(&mut self) {
        let k = self.coef;
        for m in 0..MACROS {
            let pos = self.pos[m].next();
            self.current[m] = pos;
            for slot in self.targets[m].iter_mut() {
                if let Some(s) = slot {
                    s.value += (s.goal(pos) - s.value) * k;
                    s.weight += ((if s.live { 1.0 } else { 0.0 }) - s.weight) * k;
                    if !s.live && s.weight < 1e-4 {
                        *slot = None;
                    } else if s.live && s.weight > 1.0 - 1e-4 {
                        s.weight = 1.0;
                    }
                }
            }
        }
    }

    /// Overrides base norms of `track` with each target's A→B value; later macros win on shared targets.
    pub fn apply(&self, track: u8, norms: &mut [f32]) {
        for row in &self.targets {
            for s in row.iter().flatten() {
                if s.t.target.track != track {
                    continue;
                }
                if let Some(v) = norms.get_mut(s.t.target.param as usize) {
                    *v += (s.value - *v) * s.weight;
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
        settle(&mut m);
        m.clear_target(0, 0);
        settle(&mut m);
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

    fn applied(m: &Macros, base: f32) -> f32 {
        let mut v = [base; 9];
        m.apply(0, &mut v);
        v[0]
    }

    #[test]
    fn clearing_a_target_fades_back_to_base() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, 1.0, 1.0));
        settle(&mut m);
        assert!((applied(&m, 0.0) - 1.0).abs() < 1e-3);
        let mut prev = applied(&m, 0.0);
        m.clear_target(0, 0);
        for _ in 0..4800 {
            m.advance();
            let now = applied(&m, 0.0);
            assert!((now - prev).abs() <= 0.003, "{prev} -> {now}");
            prev = now;
        }
        settle(&mut m);
        assert_eq!(applied(&m, 0.0), 0.0);
    }

    #[test]
    fn endpoint_edits_glide() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, 0.0, 0.0));
        settle(&mut m);
        m.set_target(0, 0, target(0, 0, 1.0, 1.0));
        m.advance();
        assert!(applied(&m, 0.0) < 0.01, "{}", applied(&m, 0.0));
        settle(&mut m);
        assert!((applied(&m, 0.0) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn new_target_fades_in() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, 1.0, 1.0));
        m.advance();
        assert!(applied(&m, 0.0) < 0.01);
    }
}
