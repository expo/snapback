//! Duration spelling changes no scheduler arithmetic or restart custody.
use snapback4_core::{Engine, Store, Value, value::object};
use snapback4_lang::{Bound, compile};

fn source(period: &str) -> String {
    format!("table ticks:\n  start: time\n  end: time\n  public\njob tick(periodStart: time, periodEnd: time):\n  for row in ticks:\n    update ticks[row.id] {{ start: periodStart, end: periodEnd }}\nschedule s every {period}: tick\n")
}
fn checked(period: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source(period))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

#[test]
fn schedule_units_are_exact_milliseconds_and_keep_existing_periods() {
    for (period, milliseconds, offset) in [
        ("120s", 120_000, 0), ("90s", 90_000, 0), ("60000ms", 60_000, 0),
        ("90001ms", 90_001, 0), ("2h", 7_200_000, 0), ("1d at 08:00", 86_400_000, 28_800_000),
        ("4294967296ms", 4_294_967_296, 0), ("4294967295d", 371_085_174_288_000_000, 0),
    ] {
        let b = checked(period);
        let s = &b.schema.schedules[0];
        assert_eq!((s.every_ms, s.offset_ms), (milliseconds, offset), "{period}");
    }
    assert_eq!(checked("120s").schema.schedules, checked("2m").schema.schedules);
}

#[test]
fn subminute_schedules_name_the_frequency_limit_and_working_rewrite() {
    for period in ["1500ms", "59999ms", "59s", "0m"] {
        let b = compile(&[("schema.q".into(), source(period))]);
        assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
        let d = &b.diagnostics[0];
        assert_eq!(d.code, "E_QUARRY_SYNTAX");
        assert_eq!(d.site.line, 8);
        assert_eq!(d.message, "a schedule fires at most once a minute");
        assert_eq!(d.rewrite, "every 1m");
        checked(d.rewrite.strip_prefix("every ").unwrap());
    }
    for period in ["99999999999999999999ms", "9223372036854775807d"] {
        let b = compile(&[("schema.q".into(), source(period))]);
        assert!(b.diagnostics.iter().any(|d| d.message.contains("representable millisecond range")));
    }
}

#[test]
fn exact_boundaries_and_daily_offset_execute_once_and_survive_reopen() {
    for (spelling, period, offset) in [("90s", 90_000, 0), ("120s", 120_000, 0), ("90001ms", 90_001, 0), ("1d at 08:00", 86_400_000, 28_800_000)] {
        let dir = std::env::temp_dir().join(format!("sb4-lane-k-schedule-{}-{period}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.sqlite");
        let b = checked(spelling);
        let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.seed([("ticks".into(), object([("id", Value::Id("tick".into())), ("start", Value::Int(0)), ("end", Value::Int(0))]))]).unwrap();
        assert!(e.fire_schedules(offset + 1).unwrap().is_empty());
        assert!(e.fire_schedules(offset + period - 1).unwrap().is_empty());
        assert_eq!(e.fire_schedules(offset + period).unwrap(), vec!["s"]);
        assert!(e.fire_schedules(offset + period).unwrap().is_empty());
        let job = e.run_job_chunk(offset + period).unwrap().unwrap();
        assert_eq!(job.state, snapback4_core::JobState::Done);
        let row = e.store().rows("ticks").unwrap().remove(0);
        assert_eq!(row.field("start").unwrap(), &Value::Int(offset));
        assert_eq!(row.field("end").unwrap(), &Value::Int(offset + period));
        drop(e);
        let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
        assert!(e.fire_schedules(offset + period + 1).unwrap().is_empty());
        assert!(e.fire_schedules(offset + 2 * period - 1).unwrap().is_empty());
        assert_eq!(e.fire_schedules(offset + 2 * period).unwrap(), vec!["s"]);
        e.run_job_chunk(offset + 2 * period).unwrap().unwrap();
        let row = e.store().rows("ticks").unwrap().remove(0);
        assert_eq!(row.field("start").unwrap(), &Value::Int(offset + period));
        assert_eq!(row.field("end").unwrap(), &Value::Int(offset + 2 * period));
        assert_eq!(e.jobs(10).unwrap().len(), 2);
        drop(e);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn boundaries_before_the_offset_round_down_including_negative_clocks() {
    let bound = checked("1d at 08:00");
    let schedule = &bound.schema.schedules[0];
    let day = 86_400_000;
    let eight = 28_800_000;
    for (now, expected) in [
        (0, eight - day), (eight - 1, eight - day), (eight, eight),
        (-1, eight - day), (eight - day - 1, eight - 2 * day),
    ] {
        assert_eq!(schedule.boundary(now), expected, "clock {now}");
        assert!(expected <= now && now < expected + day);
    }
}

#[test]
fn first_seen_before_eight_fires_at_eight_across_reopen() {
    let dir = std::env::temp_dir().join(format!("sb4-lane-k-before-offset-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("state.sqlite");
    let b = checked("1d at 08:00");
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("ticks".into(), object([("id", Value::Id("tick".into())), ("start", Value::Int(0)), ("end", Value::Int(0))]))]).unwrap();
    assert!(e.fire_schedules(7 * 3_600_000).unwrap().is_empty());
    drop(e);
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    let eight = 8 * 3_600_000;
    assert!(e.fire_schedules(eight - 1).unwrap().is_empty());
    assert_eq!(e.fire_schedules(eight).unwrap(), vec!["s"]);
    let job = e.run_job_chunk(eight).unwrap().unwrap();
    assert_eq!(job.state, snapback4_core::JobState::Done);
    let row = e.store().rows("ticks").unwrap().remove(0);
    assert_eq!(row.field("start").unwrap(), &Value::Int(eight - 86_400_000));
    assert_eq!(row.field("end").unwrap(), &Value::Int(eight));
    drop(e);
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert!(e.fire_schedules(eight).unwrap().is_empty());
    assert_eq!(e.jobs(10).unwrap().len(), 1);
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn sliced_schedules_keep_independent_boundaries_and_coalesce_once() {
    let b = compile(&[("schema.q".into(), format!("{}schedule second every 1m: tick\n", source("1m")))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert!(e.fire_schedule_at(0, 0).unwrap().is_empty());
    assert!(e.fire_schedule_at(0, 1).unwrap().is_empty());
    assert_eq!(e.fire_schedule_at(60_000, 0).unwrap(), ["s"]);
    assert_eq!(e.jobs(10).unwrap().len(), 1, "one slice must not fire the other schedule");
    assert!(e.fire_schedule_at(60_000, 0).unwrap().is_empty());
    assert_eq!(e.fire_schedule_at(120_000, 1).unwrap(), ["second"]);
    assert_eq!(e.jobs(10).unwrap().len(), 2, "missed boundaries coalesce");
    assert!(e.fire_schedule_at(120_000, 99).unwrap().is_empty(), "adoption can shorten the schedule set between slices");
    assert_eq!(e.fire_schedules(120_000).unwrap(), ["s"]);
    assert!(e.fire_schedules(120_000).unwrap().is_empty());
}
