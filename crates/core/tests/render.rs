use std::io::Write;
use std::path::Path;
use std::time::Instant;

use utero_core::engine::{Engine, BLOCK};
use utero_core::seq::{Cond, Step};

const SR: u32 = 48_000;

fn groove() -> Engine {
    let mut e = Engine::new(SR as f32);
    e.set_bpm(128.0);
    for s in [0, 4, 8, 12] {
        e.set_step(0, s, Step { trig: true, ..Step::default() });
    }
    e.set_length(1, 13);
    for s in [3, 7, 10] {
        e.set_step(1, s, Step { trig: true, vel: 0.6, prob: 60, ..Step::default() });
    }
    e.set_step(1, 12, Step { trig: true, vel: 0.8, cond: Cond::Ab { a: 2, b: 4 }, micro: 5, ..Step::default() });
    e.set_param(1, 0, 0.6);
    e.play();
    e
}

fn render(e: &mut Engine, secs: f32) -> Vec<f32> {
    let blocks = (SR as f32 * secs / BLOCK as f32) as usize;
    let mut out = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        e.process(BLOCK);
        out.extend_from_slice(&e.out_l);
    }
    out
}

fn write_wav(path: &Path, samples: &[f32]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut f = std::fs::File::create(path).unwrap();
    let data_len = (samples.len() * 2) as u32;
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_len).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&SR.to_le_bytes()).unwrap();
    f.write_all(&(SR * 2).to_le_bytes()).unwrap();
    f.write_all(&2u16.to_le_bytes()).unwrap();
    f.write_all(&16u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_len.to_le_bytes()).unwrap();
    for s in samples {
        f.write_all(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).unwrap();
    }
}

#[test]
fn groove_renders_clean_audio() {
    let out = render(&mut groove(), 4.0);
    assert!(out.iter().all(|s| s.is_finite()), "NaN/Inf in output");
    let peak = out.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.1 && peak <= 1.0, "peak {peak}");
    let dc = out.iter().sum::<f32>() / out.len() as f32;
    assert!(dc.abs() < 0.01, "dc {dc}");
    write_wav(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/renders/kick-groove.wav").as_path(), &out);
}

#[test]
fn same_engine_setup_renders_identically() {
    assert_eq!(render(&mut groove(), 1.0), render(&mut groove(), 1.0));
}

#[test]
#[ignore = "benchmark: run with cargo test --release -- --ignored"]
fn engine_runs_under_quarter_of_realtime() {
    let mut e = groove();
    let start = Instant::now();
    render(&mut e, 10.0);
    let elapsed = start.elapsed().as_secs_f32();
    assert!(elapsed < 2.5, "10 s of audio took {elapsed:.3} s");
}

#[test]
#[ignore = "benchmark: run with cargo test --release -- --ignored"]
fn full_modulation_runs_under_quarter_of_realtime() {
    use utero_core::macros::MacroTarget;
    use utero_core::modulation::{ModKind, ModSettings, ParamRef, Route, Shape};
    let mut e = groove();
    for slot in 0..16 {
        e.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::from_code((slot % 9) as u8), sync: false, hz: 0.5 + slot as f32, ..ModSettings::default() });
    }
    for i in 0..64 {
        e.set_route(i, Route { src: (i % 16) as u8, target: ParamRef { track: (i % 2) as u8, param: (i % 9) as u8 }, amount: 0.05 });
    }
    for m in 0..8 {
        e.set_macro_target(m, 0, MacroTarget { target: ParamRef { track: 0, param: m as u8 }, a: 0.2, b: 0.8 });
        e.set_macro_pos(m, 0.5);
    }
    let start = Instant::now();
    render(&mut e, 10.0);
    let elapsed = start.elapsed().as_secs_f32();
    println!("10 s with 16 mods / 64 routes / 8 macros took {elapsed:.3} s");
    assert!(elapsed < 2.5, "took {elapsed:.3} s");
}
