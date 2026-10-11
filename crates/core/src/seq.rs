use crate::rng::Rng;

pub const MAX_STEPS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cond {
    None,
    Ab { a: u8, b: u8 },
    Fill,
    NotFill,
    Pre,
    NotPre,
    Nei,
    First,
}

impl Cond {
    /// Codes mirror `CondCode` in web/src/state/types.ts.
    pub fn from_code(code: u8, a: u8, b: u8) -> Cond {
        match code {
            1 => Cond::Ab { a, b },
            2 => Cond::Fill,
            3 => Cond::NotFill,
            4 => Cond::Pre,
            5 => Cond::NotPre,
            6 => Cond::Nei,
            7 => Cond::First,
            _ => Cond::None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Step {
    pub trig: bool,
    pub vel: f32,
    pub prob: u8,
    pub cond: Cond,
    /// Offset in 1/24 of a step.
    pub micro: i8,
    /// MIDI note; 41 = F2.
    pub note: u8,
}

impl Default for Step {
    fn default() -> Self {
        Step { trig: false, vel: 1.0, prob: 100, cond: Cond::None, micro: 0, note: 41 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trig {
    pub vel: f32,
    pub note: u8,
}

pub struct CondCtx<'a> {
    pub fill: bool,
    pub neighbor: bool,
    pub rng: &'a mut Rng,
}

pub fn speed_ticks(code: u8) -> u64 {
    match code {
        0 => 12,
        1 => 24,
        2 => 48,
        3 => 96,
        4 => 384,
        5 => 16,
        6 => 32,
        _ => 24,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Track {
    steps: [Step; MAX_STEPS],
    length: u8,
    speed: u8,
    playhead: u16,
    last_cond: bool,
}

impl Default for Track {
    fn default() -> Self {
        Self::new()
    }
}

impl Track {
    pub fn new() -> Self {
        Track { steps: [Step::default(); MAX_STEPS], length: 16, speed: 1, playhead: 0, last_cond: false }
    }

    pub fn set_step(&mut self, i: usize, step: Step) {
        if let Some(s) = self.steps.get_mut(i) {
            *s = Step {
                micro: step.micro.clamp(-11, 11),
                prob: step.prob.min(100),
                note: step.note.min(127),
                vel: if step.vel.is_finite() { step.vel.clamp(0.0, 1.0) } else { 1.0 },
                ..step
            };
        }
    }

    pub fn set_length(&mut self, len: u8) {
        self.length = len.clamp(1, MAX_STEPS as u8);
        self.playhead %= self.length as u16;
    }

    pub fn set_speed(&mut self, code: u8) {
        self.speed = code;
    }

    pub fn length(&self) -> u8 {
        self.length
    }

    pub fn playhead(&self) -> u16 {
        self.playhead
    }

    pub fn last_cond(&self) -> bool {
        self.last_cond
    }

    pub fn reset(&mut self) {
        self.playhead = 0;
        self.last_cond = false;
    }

    /// Stateless position (tick / step_ticks) makes polymeter and length changes safe.
    pub fn on_tick(&mut self, tick: u64, ctx: &mut CondCtx) -> Option<Trig> {
        let st = speed_ticks(self.speed);
        let len = self.length as u64;
        let abs_step = tick / st;
        if tick % st == 0 {
            self.playhead = (abs_step % len) as u16;
        }
        // A step with negative µtime fires inside the previous step's window.
        for cand in [abs_step, abs_step + 1] {
            let step = self.steps[(cand % len) as usize];
            if !step.trig {
                continue;
            }
            let at = (cand * st) as i64 + (step.micro as i64 * st as i64) / 24;
            if at == tick as i64 && self.evaluate(&step, cand / len, ctx) {
                return Some(Trig { vel: step.vel, note: step.note });
            }
        }
        None
    }

    fn evaluate(&mut self, step: &Step, iteration: u64, ctx: &mut CondCtx) -> bool {
        let cond_ok = match step.cond {
            Cond::None => true,
            Cond::Ab { a, b } => b > 0 && iteration % b as u64 == (a.saturating_sub(1) % b) as u64,
            Cond::Fill => ctx.fill,
            Cond::NotFill => !ctx.fill,
            Cond::Pre => self.last_cond,
            Cond::NotPre => !self.last_cond,
            Cond::Nei => ctx.neighbor,
            Cond::First => iteration == 0,
        };
        let prob_ok = step.prob >= 100 || ctx.rng.next_f32() * 100.0 < step.prob as f32;
        let result = cond_ok && prob_ok;
        let conditional = step.cond != Cond::None || step.prob < 100;
        if conditional && !matches!(step.cond, Cond::Pre | Cond::NotPre | Cond::Nei) {
            self.last_cond = result;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn trig() -> Step {
        Step { trig: true, ..Step::default() }
    }

    pub(crate) fn run(track: &mut Track, ticks: u64, fill: bool, neighbor: bool, rng: &mut Rng) -> Vec<u64> {
        (0..ticks)
            .filter(|&t| {
                let mut ctx = CondCtx { fill, neighbor, rng };
                track.on_tick(t, &mut ctx).is_some()
            })
            .collect()
    }

    #[test]
    fn four_on_the_floor_fires_every_quarter() {
        let mut t = Track::new();
        for s in [0, 4, 8, 12] {
            t.set_step(s, trig());
        }
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 384, false, false, &mut rng), vec![0, 96, 192, 288]);
    }

    #[test]
    fn polymeter_length_three_wraps() {
        let mut t = Track::new();
        t.set_length(3);
        t.set_step(0, trig());
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 24 * 9, false, false, &mut rng), vec![0, 72, 144]);
    }

    #[test]
    fn eighth_speed_doubles_step_duration() {
        let mut t = Track::new();
        t.set_speed(2);
        t.set_step(1, trig());
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 100, false, false, &mut rng), vec![48]);
    }

    #[test]
    fn positive_microtime_delays_trig() {
        let mut t = Track::new();
        t.set_step(0, Step { micro: 6, ..trig() });
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 24, false, false, &mut rng), vec![6]);
    }

    #[test]
    fn negative_microtime_pulls_trig_early() {
        let mut t = Track::new();
        t.set_step(1, Step { micro: -6, ..trig() });
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 48, false, false, &mut rng), vec![18]);
    }

    #[test]
    fn microtime_is_clamped_below_half_a_step() {
        let mut t = Track::new();
        t.set_step(0, Step { micro: 100, ..trig() });
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 24, false, false, &mut rng), vec![11]);
    }

    #[test]
    fn playhead_follows_steps() {
        let mut t = Track::new();
        let mut rng = Rng::new(1);
        run(&mut t, 24 * 5 + 1, false, false, &mut rng);
        assert_eq!(t.playhead(), 5);
    }

    #[test]
    fn shorter_length_wraps_playhead() {
        let mut t = Track::new();
        let mut rng = Rng::new(1);
        run(&mut t, 24 * 10 + 1, false, false, &mut rng);
        assert_eq!(t.playhead(), 10);
        t.set_length(4);
        assert!(t.playhead() < 4);
        let mut ctx = CondCtx { fill: false, neighbor: false, rng: &mut rng };
        t.on_tick(24 * 11, &mut ctx);
        assert_eq!(t.playhead(), 3);
    }

    #[test]
    fn length_is_clamped_and_bad_step_index_ignored() {
        let mut t = Track::new();
        t.set_length(0);
        assert_eq!(t.length(), 1);
        t.set_length(200);
        assert_eq!(t.length(), 64);
        t.set_step(500, trig());
    }

    fn one_step(cond: Cond, prob: u8) -> Track {
        let mut t = Track::new();
        t.set_length(1);
        t.set_step(0, Step { cond, prob, ..trig() });
        t
    }

    #[test]
    fn prob_zero_never_and_hundred_always_fires() {
        let mut rng = Rng::new(42);
        assert!(run(&mut one_step(Cond::None, 0), 24 * 100, false, false, &mut rng).is_empty());
        assert_eq!(run(&mut one_step(Cond::None, 100), 24 * 100, false, false, &mut rng).len(), 100);
    }

    #[test]
    fn prob_fifty_fires_about_half_the_time() {
        let mut rng = Rng::new(42);
        let n = run(&mut one_step(Cond::None, 50), 24 * 1000, false, false, &mut rng).len();
        assert!((400..=600).contains(&n), "fired {n} of 1000");
    }

    #[test]
    fn same_seed_reproduces_probability_pattern() {
        let a = run(&mut one_step(Cond::None, 50), 24 * 64, false, false, &mut Rng::new(9));
        let b = run(&mut one_step(Cond::None, 50), 24 * 64, false, false, &mut Rng::new(9));
        assert_eq!(a, b);
    }

    #[test]
    fn ab_one_of_two_fires_on_even_iterations() {
        let mut rng = Rng::new(1);
        let fired = run(&mut one_step(Cond::Ab { a: 1, b: 2 }, 100), 24 * 6, false, false, &mut rng);
        assert_eq!(fired, vec![0, 48, 96]);
    }

    #[test]
    fn ab_with_zero_b_never_fires() {
        let mut rng = Rng::new(1);
        assert!(run(&mut one_step(Cond::Ab { a: 1, b: 0 }, 100), 24 * 4, false, false, &mut rng).is_empty());
    }

    #[test]
    fn fill_and_not_fill_follow_fill_flag() {
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut one_step(Cond::Fill, 100), 24 * 2, true, false, &mut rng).len(), 2);
        assert!(run(&mut one_step(Cond::Fill, 100), 24 * 2, false, false, &mut rng).is_empty());
        assert!(run(&mut one_step(Cond::NotFill, 100), 24 * 2, true, false, &mut rng).is_empty());
        assert_eq!(run(&mut one_step(Cond::NotFill, 100), 24 * 2, false, false, &mut rng).len(), 2);
    }

    #[test]
    fn pre_follows_previous_conditional_result() {
        let mut rng = Rng::new(1);
        let mut t = Track::new();
        t.set_length(3);
        t.set_step(0, Step { prob: 0, ..trig() });
        t.set_step(1, Step { cond: Cond::Pre, ..trig() });
        t.set_step(2, Step { cond: Cond::NotPre, ..trig() });
        assert_eq!(run(&mut t, 72, false, false, &mut rng), vec![48]);

        let mut t = Track::new();
        t.set_length(2);
        t.set_step(0, Step { cond: Cond::Fill, ..trig() });
        t.set_step(1, Step { cond: Cond::Pre, ..trig() });
        assert_eq!(run(&mut t, 48, true, false, &mut rng), vec![0, 24]);
    }

    #[test]
    fn nei_reads_neighbor_flag() {
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut one_step(Cond::Nei, 100), 24, false, true, &mut rng), vec![0]);
        assert!(run(&mut one_step(Cond::Nei, 100), 24, false, false, &mut rng).is_empty());
    }

    #[test]
    fn first_fires_only_on_first_iteration() {
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut one_step(Cond::First, 100), 24 * 4, false, false, &mut rng), vec![0]);
    }

    #[test]
    fn trig_carries_the_step_note() {
        let mut t = Track::new();
        t.set_step(0, Step { note: 53, ..trig() });
        let mut rng = Rng::new(1);
        let mut ctx = CondCtx { fill: false, neighbor: false, rng: &mut rng };
        let fired = t.on_tick(0, &mut ctx).expect("fires");
        assert_eq!(fired.note, 53);
        assert_eq!(fired.vel, 1.0);
    }

    #[test]
    fn note_defaults_to_f2_and_is_clamped() {
        assert_eq!(Step::default().note, 41);
        let mut t = Track::new();
        t.set_step(0, Step { note: 200, ..trig() });
        let mut rng = Rng::new(1);
        let mut ctx = CondCtx { fill: false, neighbor: false, rng: &mut rng };
        assert_eq!(t.on_tick(0, &mut ctx).unwrap().note, 127);
    }
}
