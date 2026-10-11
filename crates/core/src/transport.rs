pub const PPQN: u64 = 96;

#[derive(Clone, Copy, Debug)]
pub struct Transport {
    sample_rate: f64,
    bpm: f64,
    playing: bool,
    pos: u64,
    next_at: f64,
    ticks: u64,
}

impl Transport {
    pub fn new(sample_rate: f32) -> Self {
        Transport { sample_rate: sample_rate as f64, bpm: 120.0, playing: false, pos: 0, next_at: 0.0, ticks: 0 }
    }

    pub fn set_bpm(&mut self, bpm: f64) {
        if bpm.is_finite() {
            self.bpm = bpm.clamp(20.0, 300.0);
        }
    }

    pub fn bpm(&self) -> f64 {
        self.bpm
    }

    pub fn play(&mut self) {
        self.playing = true;
        self.pos = 0;
        self.next_at = 0.0;
        self.ticks = 0;
    }

    pub fn stop(&mut self) {
        self.playing = false;
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn ticks(&self) -> u64 {
        self.ticks
    }

    fn samples_per_tick(&self) -> f64 {
        self.sample_rate * 60.0 / (self.bpm * PPQN as f64)
    }

    pub fn tick(&mut self) -> Option<u64> {
        if !self.playing {
            return None;
        }
        let fired = if self.pos as f64 >= self.next_at {
            let t = self.ticks;
            self.ticks += 1;
            self.next_at += self.samples_per_tick();
            Some(t)
        } else {
            None
        };
        self.pos += 1;
        fired
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fired_samples(t: &mut Transport, samples: usize) -> Vec<(usize, u64)> {
        (0..samples).filter_map(|i| t.tick().map(|k| (i, k))).collect()
    }

    #[test]
    fn first_tick_fires_on_first_sample() {
        let mut t = Transport::new(48_000.0);
        t.play();
        assert_eq!(t.tick(), Some(0));
    }

    #[test]
    fn ticks_are_spaced_by_samples_per_tick() {
        let mut t = Transport::new(48_000.0);
        t.set_bpm(120.0); // 48000*60/(120*96) = 250 samples per tick
        t.play();
        assert_eq!(fired_samples(&mut t, 1000), vec![(0, 0), (250, 1), (500, 2), (750, 3)]);
        assert_eq!(t.ticks(), 4);
    }

    #[test]
    fn stopped_transport_never_ticks() {
        let mut t = Transport::new(48_000.0);
        assert!(fired_samples(&mut t, 1000).is_empty());
        t.play();
        t.stop();
        assert!(fired_samples(&mut t, 1000).is_empty());
    }

    #[test]
    fn play_restarts_from_zero() {
        let mut t = Transport::new(48_000.0);
        t.play();
        fired_samples(&mut t, 2000);
        t.play();
        assert_eq!(t.tick(), Some(0));
    }

    #[test]
    fn bpm_is_clamped_and_nan_ignored() {
        let mut t = Transport::new(48_000.0);
        t.set_bpm(5.0);
        assert_eq!(t.bpm(), 20.0);
        t.set_bpm(1000.0);
        assert_eq!(t.bpm(), 300.0);
        t.set_bpm(128.0);
        t.set_bpm(f64::NAN);
        assert_eq!(t.bpm(), 128.0);
    }
}
