use core::cell::UnsafeCell;

use utero_core::engine::{Engine, SNAP_LEN};
use utero_core::macros::MacroTarget;
use utero_core::modulation::{ModKind, ModSettings, NoiseColor, ParamRef, Route, Shape, TrigMode};
use utero_core::seq::{Cond, Step};

struct Global(UnsafeCell<Option<Engine>>);

// The AudioWorklet is single-threaded: only the audio thread touches the engine.
unsafe impl Sync for Global {}

static ENGINE: Global = Global(UnsafeCell::new(None));

fn eng() -> &'static mut Engine {
    unsafe { (*ENGINE.0.get()).as_mut().expect("utero_init must be called first") }
}

fn byte(v: u32) -> u8 {
    v.min(255) as u8
}

#[no_mangle]
pub extern "C" fn utero_init(sample_rate: f32) {
    unsafe { *ENGINE.0.get() = Some(Engine::new(sample_rate)) }
}

#[no_mangle]
pub extern "C" fn utero_process(frames: u32) {
    eng().process(frames as usize);
}

#[no_mangle]
pub extern "C" fn utero_out_l() -> *const f32 {
    eng().out_l.as_ptr()
}

#[no_mangle]
pub extern "C" fn utero_out_r() -> *const f32 {
    eng().out_r.as_ptr()
}

#[no_mangle]
pub extern "C" fn utero_set_param(track: u32, param: u32, value: f32) {
    eng().set_param(track as usize, param as usize, value);
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn utero_set_step(track: u32, step: u32, trig: u32, vel: f32, prob: u32, cond: u32, a: u32, b: u32, micro: i32, note: u32) {
    let s = Step {
        trig: trig != 0,
        vel,
        prob: byte(prob),
        cond: Cond::from_code(byte(cond), byte(a), byte(b)),
        micro: micro.clamp(-11, 11) as i8,
        note: byte(note).min(127),
    };
    eng().set_step(track as usize, step as usize, s);
}

#[no_mangle]
pub extern "C" fn utero_set_length(track: u32, len: u32) {
    eng().set_length(track as usize, byte(len));
}

#[no_mangle]
pub extern "C" fn utero_set_speed(track: u32, code: u32) {
    eng().set_speed(track as usize, byte(code));
}

#[no_mangle]
pub extern "C" fn utero_play() {
    eng().play();
}

#[no_mangle]
pub extern "C" fn utero_stop() {
    eng().stop();
}

#[no_mangle]
pub extern "C" fn utero_set_bpm(bpm: f32) {
    eng().set_bpm(bpm);
}

#[no_mangle]
pub extern "C" fn utero_set_fill(on: u32) {
    eng().set_fill(on != 0);
}

#[no_mangle]
pub extern "C" fn utero_tick() -> f64 {
    eng().ticks() as f64
}

#[no_mangle]
pub extern "C" fn utero_playhead(track: u32) -> i32 {
    eng().playhead(track as usize)
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn utero_set_modulator(
    slot: u32, kind: u32, shape: u32, color: u32, sync: u32, rate_index: u32, hz: f32, phase: f32,
    bipolar: u32, trig_mode: u32, trig_src: i32, smooth: f32, depth: f32, fade: f32,
) {
    let s = ModSettings {
        kind: ModKind::from_code(byte(kind)),
        shape: Shape::from_code(byte(shape)),
        color: NoiseColor::from_code(byte(color)),
        sync: sync != 0,
        rate_index: byte(rate_index),
        hz,
        phase,
        bipolar: bipolar != 0,
        trig_mode: TrigMode::from_code(byte(trig_mode)),
        trig_src: trig_src.clamp(-1, 127) as i8,
        smooth,
        depth,
        fade,
    };
    eng().set_modulator(slot as usize, s);
}

#[no_mangle]
pub extern "C" fn utero_set_mod_step(slot: u32, index: u32, value: f32) {
    eng().set_mod_step(slot as usize, index as usize, value);
}

#[no_mangle]
pub extern "C" fn utero_set_mod_env(slot: u32, a: f32, h: f32, d: f32, s: f32, r: f32) {
    eng().set_mod_env(slot as usize, [a, h, d, s, r]);
}

#[no_mangle]
pub extern "C" fn utero_set_mod_step_len(slot: u32, len: u32) {
    eng().set_mod_step_len(slot as usize, byte(len));
}

#[no_mangle]
pub extern "C" fn utero_set_route(index: u32, src: u32, track: u32, param: u32, amount: f32) {
    let r = Route { src: byte(src), target: ParamRef { track: byte(track), param: byte(param) }, amount };
    eng().set_route(index as usize, r);
}

#[no_mangle]
pub extern "C" fn utero_clear_route(index: u32) {
    eng().clear_route(index as usize);
}

#[no_mangle]
pub extern "C" fn utero_set_macro_target(m: u32, index: u32, track: u32, param: u32, a: f32, b: f32) {
    let t = MacroTarget { target: ParamRef { track: byte(track), param: byte(param) }, a, b };
    eng().set_macro_target(m as usize, index as usize, t);
}

#[no_mangle]
pub extern "C" fn utero_clear_macro_target(m: u32, index: u32) {
    eng().clear_macro_target(m as usize, index as usize);
}

#[no_mangle]
pub extern "C" fn utero_set_macro_pos(m: u32, pos: f32) {
    eng().set_macro_pos(m as usize, pos);
}

#[no_mangle]
pub extern "C" fn utero_snapshot() -> *const f32 {
    eng().snapshot.as_ptr()
}

#[no_mangle]
pub extern "C" fn utero_snapshot_len() -> u32 {
    SNAP_LEN as u32
}

#[no_mangle]
pub extern "C" fn utero_set_fx_order(track: u32, a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32, h: u32) {
    eng().set_fx_order(track as usize, [a, b, c, d, e, f, g, h].map(|v| v.min(255) as u8));
}

#[no_mangle]
pub extern "C" fn utero_set_bus_mute(bus: u32, muted: u32, quantized: u32) {
    eng().set_bus_mute(bus as usize, muted != 0, quantized != 0);
}
