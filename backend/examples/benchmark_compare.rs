//! Same successful transitions, warmup, quantiles and timing boundaries as
//! scripts/benchmark-engine-ts.ts. Measures output production, not disposal/I/O.
use avalon_server::engine::{self, CreateGame, GameEvent, PlayerId};
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Deserialize)]
struct Trace {
    input: CreateGame,
    steps: Vec<Step>,
}
#[derive(Deserialize)]
struct Step {
    event: GameEvent,
    now: i64,
}
#[derive(Serialize)]
struct Stats {
    samples: usize,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
}
fn stats(values: &[f64]) -> Stats {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let q = |p: f64| sorted[((sorted.len() as f64 * p).ceil() as usize).saturating_sub(1)];
    Stats {
        samples: sorted.len(),
        p50_ms: q(0.5),
        p95_ms: q(0.95),
        p99_ms: q(0.99),
    }
}
fn run(traces: &[Trace], viewers: &[Vec<PlayerId>], collect: bool) -> (Vec<f64>, Vec<f64>, usize) {
    let (mut updates, mut views, mut checksum) = (Vec::new(), Vec::new(), 0);
    for (trace, ids) in traces.iter().zip(viewers) {
        let mut state = engine::create_game(&trace.input).unwrap();
        for step in &trace.steps {
            let started = Instant::now();
            let result = engine::apply_owned(state.clone(), &step.event, step.now).unwrap();
            let duration = started.elapsed().as_secs_f64() * 1000.;
            if collect {
                updates.push(duration);
            }
            state = result.state;
            let started = Instant::now();
            let projected = engine::project_many(&state, ids);
            let duration = started.elapsed().as_secs_f64() * 1000.;
            if collect {
                views.push(duration);
            }
            checksum += projected
                .iter()
                .map(|v| v.players.len() + v.logs.len())
                .sum::<usize>();
            std::hint::black_box(&projected); // destruction occurs outside timing
        }
    }
    (updates, views, checksum)
}
fn main() {
    let traces: Vec<Trace> = serde_json::from_str(include_str!(
        "../tests/fixtures/resolved-engine-traces.json"
    ))
    .unwrap();
    let viewers: Vec<Vec<PlayerId>> = traces
        .iter()
        .map(|t| {
            t.input
                .players
                .iter()
                .map(|p| p.id.clone())
                .chain(std::iter::once("observer".into()))
                .collect()
        })
        .collect();
    let rounds = std::env::args()
        .nth(1)
        .map(|n| n.parse::<usize>().unwrap())
        .unwrap_or(3);
    assert!((1..=20).contains(&rounds));
    run(&traces, &viewers, false);
    let (mut updates, mut views, mut runs) = (Vec::new(), Vec::new(), Vec::new());
    for _ in 0..rounds {
        let (u, v, checksum) = run(&traces, &viewers, true);
        runs.push(serde_json::json!({"update":stats(&u),"views":stats(&v),"checksum":checksum}));
        updates.extend(u);
        views.extend(v);
    }
    println!(
        "{}",
        serde_json::json!({"runtime":"Rust release","architecture":std::env::consts::ARCH,"rounds":rounds,"traces":traces.len(),"update":stats(&updates),"views":stats(&views),"runs":runs})
    );
}
