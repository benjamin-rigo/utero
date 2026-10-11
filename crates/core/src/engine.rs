use crate::bus::{Bus, BUSES};
use crate::kick::{kick_params, KickVoice};
use crate::macros::{MacroTarget, Macros};
use crate::master::Master;
use crate::mid::{is_linked, mid_params, MidVoice};
use crate::modulation::{ModMatrix, ModSettings, Route, MOD_PARAMS, MOD_ROWS, MOD_SLOTS};
use crate::params::{ParamBank, MAX_PARAMS};
use crate::rng::Rng;
use crate::seq::{CondCtx, Step, Track, Trig};
use crate::sub::{is_direct, sub_params, SubVoice};
use crate::transport::{Transport, PPQN};

pub const BLOCK: usize = 128;
pub const TRACKS: usize = 13;
/// Parameter rows: 0–12 tracks, 13–20 buses, 21 master (also the modulation/macro target rows).
pub const ROWS: usize = TRACKS + BUSES + 1;
pub const MASTER_ROW: usize = TRACKS + BUSES;
pub const SUB_TRACK: usize = 7;
pub const MID_TRACK: usize = 8;
/// KICK·KCK2 → KICK, HH·OH → HATS, SNR·NOIS·SMPL → PERC, SUB·MID → BASS, LD1·LD2 → LEAD, PAD, ORN; bus 7 = FX RTN.
pub const TRACK_BUS: [usize; TRACKS] = [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6];
const BAR_TICKS: u64 = PPQN * 4;
const MUTE_LEAD_TICKS: u64 = 3;

/// Snapshot layout, mirrored in web/src/audio/snapshot.ts.
pub const SNAP_TICK: usize = 0;
pub const SNAP_PLAYHEADS: usize = 1;
pub const SNAP_MODS: usize = SNAP_PLAYHEADS + TRACKS;
pub const SNAP_EFFECTIVE: usize = SNAP_MODS + MOD_SLOTS;
/// Per bus: peak, rms; then master: peak L, peak R, short-term LUFS, gain reduction dB.
pub const SNAP_METERS: usize = SNAP_EFFECTIVE + ROWS * MOD_PARAMS;
pub const SNAP_MUTED: usize = SNAP_METERS + BUSES * 2 + 4;
pub const SNAP_LEN: usize = SNAP_MUTED + BUSES;

const _: () = assert!(ROWS == MOD_ROWS && MAX_PARAMS == MOD_PARAMS);

enum Voice {
    None,
    Kick(KickVoice),
    Sub(SubVoice),
    Mid(MidVoice),
}

struct Machine {
    voice: Voice,
    params: ParamBank,
}

impl Machine {
    fn for_track(t: usize, sample_rate: f32) -> Self {
        match t {
            0 | 1 => Machine { voice: Voice::Kick(KickVoice::new(sample_rate, 0x00C0_FFEE + t as u32)), params: kick_params(sample_rate) },
            SUB_TRACK => Machine { voice: Voice::Sub(SubVoice::new(sample_rate)), params: sub_params(sample_rate) },
            MID_TRACK => Machine { voice: Voice::Mid(MidVoice::new(sample_rate, 0x000B_A55E)), params: mid_params(sample_rate) },
            _ => Machine { voice: Voice::None, params: ParamBank::new(&[], sample_rate) },
        }
    }

    fn is_active(&self) -> bool {
        match &self.voice {
            Voice::Kick(v) => v.is_active(),
            Voice::Sub(v) => v.is_active(),
            Voice::Mid(v) => v.is_active(),
            Voice::None => false,
        }
    }
}

pub struct Engine {
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    pub snapshot: [f32; SNAP_LEN],
    sample_rate: f32,
    transport: Transport,
    tracks: [Track; TRACKS],
    machines: [Machine; TRACKS],
    buses: [Bus; BUSES],
    master: Master,
    effective: [[f32; MAX_PARAMS]; ROWS],
    pending_mute: [Option<bool>; BUSES],
    mods: ModMatrix,
    macros: Macros,
    rng: Rng,
    fill: bool,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        let mut e = Engine {
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            snapshot: [0.0; SNAP_LEN],
            sample_rate,
            transport: Transport::new(sample_rate),
            tracks: [Track::new(); TRACKS],
            machines: core::array::from_fn(|t| Machine::for_track(t, sample_rate)),
            buses: core::array::from_fn(|_| Bus::new(sample_rate)),
            master: Master::new(sample_rate),
            effective: [[0.0; MAX_PARAMS]; ROWS],
            pending_mute: [None; BUSES],
            mods: ModMatrix::new(),
            macros: Macros::new(sample_rate),
            rng: Rng::new(0x5EED),
            fill: false,
        };
        for row in 0..ROWS {
            if let Some(defaults) = e.bank(row).map(|b| b.defaults()) {
                e.effective[row] = defaults;
            }
        }
        e
    }

    fn bank(&self, row: usize) -> Option<&ParamBank> {
        match row {
            r if r < TRACKS => Some(&self.machines[r].params),
            r if r < MASTER_ROW => Some(&self.buses[r - TRACKS].params),
            MASTER_ROW => Some(&self.master.params),
            _ => None,
        }
    }

    fn bank_mut(&mut self, row: usize) -> Option<&mut ParamBank> {
        match row {
            r if r < TRACKS => Some(&mut self.machines[r].params),
            r if r < MASTER_ROW => Some(&mut self.buses[r - TRACKS].params),
            MASTER_ROW => Some(&mut self.master.params),
            _ => None,
        }
    }

    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.reset();
        }
        self.mods.restart();
        self.transport.play();
    }

    pub fn stop(&mut self) {
        self.transport.stop();
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        self.transport.set_bpm(bpm as f64);
    }

    pub fn set_fill(&mut self, on: bool) {
        self.fill = on;
    }

    pub fn set_step(&mut self, track: usize, index: usize, step: Step) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_step(index, step);
        }
    }

    pub fn set_length(&mut self, track: usize, len: u8) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_length(len);
        }
    }

    pub fn set_speed(&mut self, track: usize, code: u8) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_speed(code);
        }
    }

    /// `row` 0–12 = track machine, 13–20 = bus, 21 = master.
    pub fn set_param(&mut self, row: usize, param: usize, norm: f32) {
        if let Some(bank) = self.bank_mut(row) {
            bank.set_norm(param, norm);
        }
    }

    /// A quantized change while playing waits for the next bar; stopped, it applies at once.
    pub fn set_bus_mute(&mut self, bus: usize, muted: bool, quantized: bool) {
        if bus >= BUSES {
            return;
        }
        if quantized && self.transport.is_playing() {
            self.pending_mute[bus] = Some(muted);
        } else {
            self.pending_mute[bus] = None;
            self.buses[bus].set_muted(muted);
        }
    }

    pub fn bus_muted(&self, bus: usize) -> bool {
        self.buses.get(bus).is_some_and(|b| b.muted())
    }

    pub fn track_active(&self, track: usize) -> bool {
        self.machines.get(track).is_some_and(|m| m.is_active())
    }

    pub fn set_modulator(&mut self, slot: usize, s: ModSettings) {
        self.mods.set_modulator(slot, s);
    }

    pub fn set_mod_step(&mut self, slot: usize, i: usize, v: f32) {
        self.mods.set_step(slot, i, v);
    }

    pub fn set_mod_step_len(&mut self, slot: usize, len: u8) {
        self.mods.set_step_len(slot, len);
    }

    pub fn set_route(&mut self, index: usize, route: Route) {
        self.mods.set_route(index, route);
    }

    pub fn clear_route(&mut self, index: usize) {
        self.mods.clear_route(index);
    }

    pub fn set_macro_target(&mut self, m: usize, i: usize, t: MacroTarget) {
        self.macros.set_target(m, i, t);
    }

    pub fn clear_macro_target(&mut self, m: usize, i: usize) {
        self.macros.clear_target(m, i);
    }

    pub fn set_macro_pos(&mut self, m: usize, pos: f32) {
        self.macros.set_pos(m, pos);
    }

    pub fn mod_output(&self, slot: usize) -> f32 {
        self.mods.output(slot)
    }

    pub fn effective_norm(&self, row: usize, param: usize) -> f32 {
        match self.bank(row) {
            Some(b) if param < b.count() => self.effective[row][param],
            _ => -1.0,
        }
    }

    pub fn playhead(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(-1, |t| t.playhead() as i32)
    }

    pub fn ticks(&self) -> u64 {
        self.transport.ticks()
    }

    /// base (smoothed) → macro override → + modulation → clamp; records the effective norms of `row`.
    fn resolve(&mut self, row: usize) -> [f32; MAX_PARAMS] {
        let Some(bank) = self.bank_mut(row) else { return [0.0; MAX_PARAMS] };
        let count = bank.count();
        let mut norms = bank.next_norms();
        self.macros.apply(row as u8, &mut norms[..count]);
        for (p, v) in norms.iter_mut().enumerate().take(count) {
            *v = (*v + self.mods.sum(row, p)).clamp(0.0, 1.0);
        }
        self.effective[row] = norms;
        norms
    }

    pub fn process(&mut self, frames: usize) {
        let bpm = self.transport.bpm() as f32;
        for i in 0..frames.min(BLOCK) {
            if let Some(tick) = self.transport.tick() {
                self.on_tick(tick);
            }
            self.mods.advance(bpm, self.sample_rate);
            self.macros.advance();

            let mut bus_in = [0.0_f32; BUSES];
            let mut bus_post = [0.0_f32; BUSES];
            for t in 0..TRACKS {
                if matches!(self.machines[t].voice, Voice::None) {
                    continue;
                }
                let norms = self.resolve(t);
                let Machine { voice, params } = &mut self.machines[t];
                params.apply_norms(&norms);
                let y = match voice {
                    Voice::Kick(v) => v.render(params),
                    Voice::Sub(v) => v.render(params),
                    Voice::Mid(v) => v.render(params),
                    Voice::None => 0.0,
                };
                let b = TRACK_BUS[t];
                if t == SUB_TRACK && is_direct(params) {
                    bus_post[b] += y;
                } else {
                    bus_in[b] += y;
                }
            }

            let (mut mix_l, mut mix_r) = (0.0, 0.0);
            for b in 0..BUSES {
                let norms = self.resolve(TRACKS + b);
                self.buses[b].params.apply_norms(&norms);
                let (l, r) = self.buses[b].process(bus_in[b], bus_in[b], bus_post[b], bus_post[b]);
                mix_l += l;
                mix_r += r;
            }

            let norms = self.resolve(MASTER_ROW);
            self.master.params.apply_norms(&norms);
            let (l, r) = self.master.process(mix_l, mix_r);
            self.out_l[i] = if l.is_finite() { l } else { 0.0 };
            self.out_r[i] = if r.is_finite() { r } else { 0.0 };
        }
        self.write_snapshot();
    }

    fn write_snapshot(&mut self) {
        self.snapshot[SNAP_TICK] = self.transport.ticks() as f32;
        for t in 0..TRACKS {
            self.snapshot[SNAP_PLAYHEADS + t] = self.tracks[t].playhead() as f32;
        }
        for m in 0..MOD_SLOTS {
            self.snapshot[SNAP_MODS + m] = self.mods.output(m);
        }
        for row in 0..ROWS {
            let base = SNAP_EFFECTIVE + row * MOD_PARAMS;
            self.snapshot[base..base + MOD_PARAMS].copy_from_slice(&self.effective[row]);
        }
        for b in 0..BUSES {
            self.snapshot[SNAP_METERS + 2 * b] = self.buses[b].peak();
            self.snapshot[SNAP_METERS + 2 * b + 1] = self.buses[b].rms();
            self.snapshot[SNAP_MUTED + b] = if self.buses[b].muted() { 1.0 } else { 0.0 };
        }
        let m = SNAP_METERS + 2 * BUSES;
        self.snapshot[m] = self.master.peak(0);
        self.snapshot[m + 1] = self.master.peak(1);
        self.snapshot[m + 2] = self.master.lufs();
        self.snapshot[m + 3] = self.master.gr_db();
    }

    fn on_tick(&mut self, tick: u64) {
        // Apply quantized mutes 3 ticks (~6 ms) before the downbeat so the 5 ms fade is done when bar 1 hits.
        if (tick + MUTE_LEAD_TICKS) % BAR_TICKS == 0 {
            for b in 0..BUSES {
                if let Some(m) = self.pending_mute[b].take() {
                    self.buses[b].set_muted(m);
                }
            }
        }
        let mut neighbor = false;
        for t in 0..TRACKS {
            let mut ctx = CondCtx { fill: self.fill, neighbor, rng: &mut self.rng };
            if let Some(trig) = self.tracks[t].on_tick(tick, &mut ctx) {
                self.trigger(t, trig);
                self.mods.on_track_trigger(t);
            }
            neighbor = self.tracks[t].last_cond();
        }
    }

    fn trigger(&mut self, t: usize, trig: Trig) {
        let linked = is_linked(&self.machines[MID_TRACK].params);
        let Machine { voice, params } = &mut self.machines[t];
        match voice {
            Voice::Kick(v) => v.trigger(trig.vel, &mut self.rng),
            Voice::Sub(v) => v.trigger(trig.vel, trig.note, params, &mut self.rng),
            Voice::Mid(v) if !linked => v.trigger(trig.vel, trig.note, params, &mut self.rng),
            _ => {}
        }
        // LINK: MID plays SUB's notes instead of its own steps.
        if t == SUB_TRACK && linked {
            let Machine { voice, params } = &mut self.machines[MID_TRACK];
            if let Voice::Mid(v) = voice {
                v.trigger(trig.vel, trig.note, params, &mut self.rng);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kick::DECAY;

    fn render_seconds(e: &mut Engine, secs: f32) -> Vec<f32> {
        let mut out = Vec::new();
        let blocks = (48_000.0 * secs / BLOCK as f32) as usize;
        for _ in 0..blocks {
            e.process(BLOCK);
            out.extend_from_slice(&e.out_l);
        }
        out
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
    }

    fn quarter_kick(e: &mut Engine) {
        for s in [0, 4, 8, 12] {
            e.set_step(0, s, Step { trig: true, ..Step::default() });
        }
    }

    #[test]
    fn silent_when_stopped() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        assert!(render_seconds(&mut e, 0.5).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn kick_lands_on_the_second_beat() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0); // quarter = 24000 samples
        e.set_param(0, DECAY, 0.0); // 50 ms
        quarter_kick(&mut e);
        e.play();
        let out = render_seconds(&mut e, 1.0);
        assert!(rms(&out[23_000..23_900]) < 0.01);
        assert!(rms(&out[24_000..24_900]) > 0.1);
    }

    #[test]
    fn output_is_clamped_to_unit_range() {
        let mut e = Engine::new(48_000.0);
        for t in 0..2 {
            for p in 0..9 {
                e.set_param(t, p, 1.0);
            }
            e.set_step(t, 0, Step { trig: true, ..Step::default() });
        }
        e.set_param(0, crate::kick::DRIVE, 0.0);
        e.play();
        assert!(render_seconds(&mut e, 1.0).iter().all(|s| s.abs() <= 1.0));
    }

    #[test]
    fn out_of_range_commands_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_param(99, 0, 0.5);
        e.set_param(0, 50, 0.5);
        e.set_param(0, 0, f32::NAN);
        e.set_step(99, 0, Step::default());
        e.set_step(0, 200, Step::default());
        e.set_length(99, 4);
        e.set_speed(99, 2);
        e.set_bpm(f32::NAN);
        assert_eq!(e.playhead(99), -1);
        e.play();
        e.process(10_000); // more frames than BLOCK
        assert!(e.out_l.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn playheads_advance_per_track_length() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0);
        e.set_length(1, 3);
        e.play();
        render_seconds(&mut e, 1.0); // 1 s at 120 bpm = 8 sixteenths
        assert_eq!(e.playhead(0), 7);
        assert_eq!(e.playhead(1), 7 % 3);
    }

    use crate::macros::MacroTarget;
    use crate::modulation::{ModKind, ModSettings, ParamRef, Route, Shape, TrigMode};

    fn square(e: &mut Engine, slot: usize) {
        e.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, sync: false, hz: 0.01, ..ModSettings::default() });
    }

    fn route(src: u8, track: u8, param: u8, amount: f32) -> Route {
        Route { src, target: ParamRef { track, param }, amount }
    }

    #[test]
    fn routed_lfo_moves_the_effective_value() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        e.set_route(0, route(0, 0, DECAY as u8, 0.3));
        render_seconds(&mut e, 0.2);
        let expected = crate::kick::KICK_PARAMS[DECAY].default_norm + 0.3;
        assert!((e.effective_norm(0, DECAY) - expected).abs() < 0.01, "{}", e.effective_norm(0, DECAY));
    }

    #[test]
    fn modulation_is_clamped_to_range() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        square(&mut e, 1);
        e.set_route(0, route(0, 0, 8, 1.0));
        e.set_route(1, route(1, 0, 8, 1.0));
        render_seconds(&mut e, 0.5);
        assert_eq!(e.effective_norm(0, 8), 1.0);
    }

    #[test]
    fn macro_overrides_the_base_value() {
        let mut e = Engine::new(48_000.0);
        e.set_macro_target(0, 0, MacroTarget { target: ParamRef { track: 1, param: 0 }, a: 0.0, b: 1.0 });
        e.set_macro_pos(0, 1.0);
        render_seconds(&mut e, 0.5);
        assert!((e.effective_norm(1, 0) - 1.0).abs() < 1e-3);
        assert!((e.effective_norm(0, 0) - crate::kick::KICK_PARAMS[0].default_norm).abs() < 1e-3);
    }

    #[test]
    fn macro_and_route_on_the_same_param_stack() {
        let mut e = Engine::new(48_000.0);
        e.set_macro_target(0, 0, MacroTarget { target: ParamRef { track: 0, param: DECAY as u8 }, a: 0.2, b: 0.2 });
        square(&mut e, 0);
        e.set_route(0, route(0, 0, DECAY as u8, 0.3));
        render_seconds(&mut e, 0.5);
        assert!((e.effective_norm(0, DECAY) - 0.5).abs() < 0.01, "{}", e.effective_norm(0, DECAY));
    }

    #[test]
    fn firing_track_restarts_its_retrig_modulator() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0);
        e.set_modulator(0, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, sync: false, hz: 0.1, trig_mode: TrigMode::Retrig, trig_src: 0, ..ModSettings::default() });
        e.set_step(0, 8, Step { trig: true, ..Step::default() }); // fires at sample 48 000
        e.play();
        for _ in 0..375 {
            e.process(BLOCK);
        }
        assert!(e.mod_output(0) > 0.05);
        e.process(BLOCK);
        assert!(e.mod_output(0) < 0.01);
    }

    #[test]
    fn snapshot_mirrors_engine_state() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 2);
        e.play();
        render_seconds(&mut e, 0.3);
        assert_eq!(e.snapshot[SNAP_TICK], e.ticks() as f32);
        assert_eq!(e.snapshot[SNAP_PLAYHEADS], e.playhead(0) as f32);
        assert_eq!(e.snapshot[SNAP_MODS + 2], e.mod_output(2));
        assert_eq!(e.snapshot[SNAP_EFFECTIVE + DECAY], e.effective_norm(0, DECAY));
        assert_eq!(SNAP_LEN, 586);
    }

    #[test]
    fn bad_modulation_commands_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_modulator(99, ModSettings::default());
        e.set_mod_step(99, 0, 1.0);
        e.set_mod_step_len(99, 3);
        e.set_route(999, route(0, 0, 0, 0.5));
        e.clear_route(999);
        e.set_macro_target(99, 0, MacroTarget { target: ParamRef { track: 0, param: 0 }, a: 0.0, b: 1.0 });
        e.clear_macro_target(99, 99);
        e.set_macro_pos(99, 1.0);
        assert_eq!(e.mod_output(99), 0.0);
        assert_eq!(e.effective_norm(5, 0), -1.0);
        assert_eq!(e.effective_norm(0, 50), -1.0);
        e.play();
        render_seconds(&mut e, 0.1);
        assert!(e.out_l.iter().all(|s| s.is_finite()));
    }

    use crate::bus;
    use crate::dsp::db_to_gain;
    use crate::master;
    use crate::mid;
    use crate::sub;

    fn bass_step(e: &mut Engine, track: usize, note: u8) {
        e.set_step(track, 0, Step { trig: true, note, ..Step::default() });
    }

    #[test]
    fn sub_plays_its_note_through_the_bass_bus() {
        let mut e = Engine::new(48_000.0);
        bass_step(&mut e, SUB_TRACK, 41);
        e.play();
        let out = render_seconds(&mut e, 0.5);
        assert!(rms(&out) > 0.05, "{}", rms(&out));
    }

    #[test]
    fn muting_the_kick_bus_silences_the_kick() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        e.set_bus_mute(0, true, false);
        e.play();
        let out = render_seconds(&mut e, 0.5);
        assert!(rms(&out[9_600..]) < 1e-3);
    }

    #[test]
    fn quantized_mute_waits_for_the_next_bar() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0); // one bar = 2 s = 96 000 samples
        quarter_kick(&mut e);
        e.play();
        render_seconds(&mut e, 0.25);
        e.set_bus_mute(0, true, true);
        assert!(!e.bus_muted(0));
        render_seconds(&mut e, 1.5);
        assert!(!e.bus_muted(0));
        render_seconds(&mut e, 0.5);
        assert!(e.bus_muted(0));
    }

    #[test]
    fn quantized_mute_while_stopped_is_immediate() {
        let mut e = Engine::new(48_000.0);
        e.set_bus_mute(3, true, true);
        assert!(e.bus_muted(3));
        e.set_bus_mute(3, false, true);
        assert!(!e.bus_muted(3));
    }

    #[test]
    fn linked_mid_follows_the_sub() {
        for (link, expect) in [(0.0, false), (1.0, true)] {
            let mut e = Engine::new(48_000.0);
            e.set_param(MID_TRACK, mid::LINK, link);
            bass_step(&mut e, SUB_TRACK, 41);
            render_seconds(&mut e, 0.05); // let the LINK norm settle before the first trig
            e.play();
            render_seconds(&mut e, 0.05);
            assert_eq!(e.track_active(MID_TRACK), expect);
        }
    }

    #[test]
    fn direct_sub_bypasses_the_bass_bus_filter() {
        let level = |route: f32| {
            let mut e = Engine::new(48_000.0);
            e.set_param(TRACKS + 3, bus::FILTER, 0.0);
            e.set_param(SUB_TRACK, sub::ROUTE, route);
            bass_step(&mut e, SUB_TRACK, 41);
            e.play();
            rms(&render_seconds(&mut e, 0.5)[4_800..])
        };
        assert!(level(1.0) > 2.0 * level(0.0));
    }

    #[test]
    fn limiter_holds_the_ceiling_under_heavy_modulation() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        for (i, (row, param)) in [(0, 8), (1, 8), (TRACKS, bus::LEVEL), (MASTER_ROW, master::LEVEL), (MASTER_ROW, master::SAT)].into_iter().enumerate() {
            e.set_route(i, route(0, row as u8, param as u8, 1.0));
        }
        quarter_kick(&mut e);
        bass_step(&mut e, SUB_TRACK, 41);
        e.play();
        let ceiling = db_to_gain(-0.3) + 1e-6;
        let mut out = Vec::new();
        for _ in 0..375 {
            e.process(BLOCK);
            out.extend_from_slice(&e.out_l);
            out.extend_from_slice(&e.out_r);
        }
        assert!(out.iter().all(|s| s.abs() <= ceiling));
    }

    #[test]
    fn bus_and_master_rows_accept_modulation() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        e.set_route(0, route(0, MASTER_ROW as u8, master::LEVEL as u8, -0.3));
        render_seconds(&mut e, 0.3);
        assert!((e.effective_norm(MASTER_ROW, master::LEVEL) - 0.5).abs() < 0.01);
    }

    #[test]
    fn bad_rows_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_param(99, 0, 0.5);
        e.set_param(TRACKS, 99, 0.5);
        e.set_bus_mute(99, true, false);
        assert_eq!(e.effective_norm(ROWS, 0), -1.0);
        assert_eq!(e.effective_norm(5, 0), -1.0);
        assert_eq!(e.effective_norm(TRACKS, bus::BUS_PARAM_COUNT), -1.0);
        assert!(!e.bus_muted(99));
        assert!(!e.track_active(99));
    }

    #[test]
    fn snapshot_carries_meters_and_mutes() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        e.set_bus_mute(2, true, false);
        e.play();
        render_seconds(&mut e, 0.5);
        assert!(e.snapshot[SNAP_METERS] > 0.0, "kick bus peak");
        assert_eq!(e.snapshot[SNAP_MUTED + 2], 1.0);
        assert!(e.snapshot[SNAP_METERS + 2 * bus::BUSES + 2] > -70.0, "master lufs");
    }
    #[test]
    fn quantized_mute_catches_the_downbeat() {
        let downbeat = |mute: bool| {
            let mut e = Engine::new(48_000.0);
            e.set_bpm(120.0);
            quarter_kick(&mut e);
            e.play();
            render_seconds(&mut e, 1.0);
            e.set_bus_mute(0, mute, true);
            render_seconds(&mut e, 1.0); // up to the bar line at 96 000 samples
            rms(&render_seconds(&mut e, 0.05))
        };
        assert!(downbeat(true) < 0.1 * downbeat(false), "{} vs {}", downbeat(true), downbeat(false));
    }

}
