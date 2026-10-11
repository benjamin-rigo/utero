use core::cell::UnsafeCell;

use utero_core::engine::Engine;
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
pub extern "C" fn utero_set_step(track: u32, step: u32, trig: u32, vel: f32, prob: u32, cond: u32, a: u32, b: u32, micro: i32) {
    let s = Step {
        trig: trig != 0,
        vel,
        prob: byte(prob),
        cond: Cond::from_code(byte(cond), byte(a), byte(b)),
        micro: micro.clamp(-11, 11) as i8,
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
