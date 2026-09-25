//! Builder copied from lane B1 (round 3); extended with every recount-commit observation.
//! Paired worlds: compare serialized observable channels, never raw server rows.
#![allow(dead_code)]
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, ir::ProgramKind, wire};
use std::collections::BTreeMap;
pub type Seed = Vec<(String, Json)>;
pub type Transcript = BTreeMap<String, Json>;
pub const NOW: i64 = 1000;

#[derive(Clone)]
pub struct Operation {
    pub name: String,
    pub args: Json,
    pub principal: String,
    pub now: i64,
}
impl Operation {
    pub fn new(name: &str, args: Json, principal: &str) -> Self {
        Self {
            name: name.into(),
            args,
            principal: principal.into(),
            now: NOW,
        }
    }
}
pub struct Pair {
    pub source: String,
    pub seeds: [Seed; 2],
    pub principal: String,
    pub operations: Vec<Operation>,
    pub queries: BTreeMap<String, Json>,
    pub refused: bool,
    pub page_size: usize,
    pub file_store: bool,
    pub examined: Option<u64>,
    pub write_refusal: Option<&'static str>,
}
impl Pair {
    pub fn new(
        source: impl Into<String>,
        seeds: [Seed; 2],
        principal: &str,
        operation: Operation,
    ) -> Self {
        Self {
            source: source.into(),
            seeds,
            principal: principal.into(),
            operations: vec![operation],
            queries: BTreeMap::new(),
            refused: false,
            page_size: 2,
            file_store: false,
            examined: None,
            write_refusal: None,
        }
    }
    pub fn query(mut self, name: &str, args: Json) -> Self {
        self.queries.insert(name.into(), args);
        self
    }
    pub fn then(mut self, operation: Operation) -> Self {
        self.operations.push(operation);
        self
    }
    /// Refused configurations are checked at compilation and again as raw IR.
    /// No fictional runtime transcript is substituted for schema admission.
    pub fn refused_backend(&self) -> Option<(snapback4_core::Schema, Vec<snapback4_core::ir::Program>)> {
        if !self.refused { return None; }
        let rejected = snapback4_lang::compile(&[("schema.q".into(), self.source.clone())]);
        assert!(rejected.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY"), "{:?}", rejected.diagnostics);
        let start = self.source.find("table messages:").unwrap();
        let end = self.source[start..].find("  read <- ").unwrap() + start;
        let line = self.source[end..].find('\n').unwrap() + end;
        let mut allowed = self.source.clone();
        allowed.replace_range(end..line, "  read <- allow");
        let stop = allowed.find("view unread:").unwrap();
        let block = allowed[start..stop].replace("sync to .senderId", "sync public");
        allowed.replace_range(start..stop, &block);
        let mut b = snapback4_lang::compile(&[("schema.q".into(), allowed)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        b.schema.tables.get_mut("messages").unwrap().rules.read = rejected.schema.tables["messages"].rules.read.clone();
        b.schema.tables.get_mut("messages").unwrap().sync = None;
        let programs: Vec<_> = b.programs.into_iter().map(|p|p.program).collect();
        let error = Engine::memory(b.schema.clone(), programs.clone()).err().expect("raw schema must refuse");
        assert_eq!(error.refusal().code, "E_VIEW_KEY", "{error}");
        Some((b.schema, programs))
    }
    pub fn engine(&self, world: usize) -> Engine {
        let source = format!(
            "{}\ntable pairAnchor:\n  public\n  online only\n",
            self.source
        );
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let mut rows = self.seeds[world]
            .iter()
            .map(|(t, r)| {
                (
                    t.clone(),
                    wire::row_from_json(&b.schema.tables[t], r).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        rows.push((
            "pairAnchor".into(),
            wire::row_from_json(&b.schema.tables["pairAnchor"], &json!({"id":"anchor"})).unwrap(),
        ));
        let mut programs = b
            .programs
            .into_iter()
            .map(|p| p.program)
            .collect::<Vec<_>>();
        // Timeline history must be established by operations, never imported.
        let body = rows
            .into_iter()
            .map(|(table, row)| snapback4_core::ir::Stmt::Insert {
                table,
                row: snapback4_core::ir::Expr::Literal(row),
            })
            .collect();
        programs.push(snapback4_core::ir::Program {
            name: "pairSeed".into(),
            kind: ProgramKind::Mutation,
            args: Default::default(),
            read_time_granularity_ms: None,
            body,
            native: false,
            returned_shapes: Default::default(),
        });
        let mut e = if self.file_store {
            // An unlinked open SQLite file gives independent file-backed stores
            // without leaving test data outside this worktree.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target").join(format!("b3-pair-{}-{}.sqlite", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
            let store = snapback4_core::Store::open(&path).unwrap();
            std::fs::remove_file(path).unwrap();
            Engine::new(store, b.schema, programs).unwrap()
        } else { Engine::memory(b.schema, programs).unwrap() };
        e.set_ceilings(snapback4_core::Ceilings::unbounded());
        let seed = e
            .mutate("pairSeed", None, Context::system().at(NOW))
            .unwrap();
        assert!(
            matches!(seed.state, snapback4_core::WriteState::Sent { .. }),
            "{seed:?}"
        );
        let mut ceilings = snapback4_core::Ceilings::default();
        if let Some(examined) = self.examined { ceilings.examined = examined; }
        e.set_ceilings(ceilings);
        e
    }
    pub fn assert_equal(&self) {
        if self.refused_backend().is_some() { return; }
        self.assert_with(|_, _, _, _, _| Json::Null);
    }
    /// The device counterpart observes the same pages and engine phases.
    pub fn assert_with(&self, mut device: impl FnMut(usize, &mut Engine, &str, &[Json], i64) -> Json) -> Transcript {
        let worlds = [0, 1].map(|world| {
            let mut e = self.engine(world);
            let mut transcript = Transcript::new();
            let mut now = NOW;
            let base = e.seq().unwrap();
            let mut watermark = base;
            let pages = snapshot(&mut e, &self.principal, now, self.page_size);
            transcript.insert("initial/snapshot".into(), json!(pages));
            transcript.insert(
                "initial/device".into(),
                device(world, &mut e, "initial", &pages, now),
            );
            observe_queries(
                &mut e,
                &self.principal,
                &self.queries,
                "initial",
                &mut transcript, now,
            );
            for (n, op) in self.operations.iter().enumerate() {
                now = op.now;
                transcript.insert(format!("{n}/admission"), device(world, &mut e, &format!("admit/{n}"), &[], now));
                let args = inputs(&e, &op.name, &op.args);
                let result = e
                    .mutate(
                        &op.name,
                        Some(&format!("operation-{n}")),
                        Context::new(&op.principal, args)
                            .at(now)
                            .with_ids([format!("new-{n}")]),
                    )
                    .unwrap();
                if let Some(code) = self.write_refusal {
                    assert!(matches!(&result.state, snapback4_core::WriteState::Failed { why, .. } if why.code == code), "expected {code}: {result:?}");
                }
                transcript.insert(format!("{n}/settlement"), device(world, &mut e, &format!("settle/{n}"), &[json!(result)], now));
                if op.principal == self.principal {
                    transcript.insert(format!("{n}/write"), serde_json::to_value(result).unwrap());
                } else if self.write_refusal.is_none() {
                    assert!(
                        matches!(result.state, snapback4_core::WriteState::Sent { .. }),
                        "background writer refused: {result:?}"
                    );
                }
                let pages = stream(&mut e, &self.principal, &mut watermark, now, self.page_size);
                transcript.insert(format!("{n}/write-stream"), json!(pages));
                transcript.insert(
                    format!("{n}/write-device"),
                    device(world, &mut e, "stream", &pages, now),
                );
                transcript.insert(
                    format!("{n}/write-changes"),
                    json!(e.changes(base, 10000).unwrap()),
                );
                observe_queries(&mut e, &self.principal, &self.queries, &format!("{n}/immediate"), &mut transcript, now);
                let mut sequence = Vec::new();
                for tick in 0..1000 {
                    let timeline = e.run_timeline_chunk(now).unwrap();
                    let aggregate = e.run_job_chunk(now).unwrap();
                    let view = e.run_view_chunk(now).unwrap();
                    let phase = format!("{n}/background/{tick}");
                    transcript.insert(
                        format!("{phase}/changes"),
                        json!(e.changes(base, 10000).unwrap()),
                    );
                    let pages = stream(&mut e, &self.principal, &mut watermark, now, self.page_size);
                    transcript.insert(format!("{phase}/stream"), json!(pages));
                    transcript.insert(
                        format!("{phase}/device"),
                        device(world, &mut e, "stream", &pages, now),
                    );
                    observe_queries(
                        &mut e,
                        &self.principal,
                        &self.queries,
                        &phase,
                        &mut transcript, now,
                    );
                    sequence.push(e.seq().unwrap() - base);
                    if timeline.is_none() && aggregate.is_none() && view.is_none() {
                        break;
                    }
                    assert!(tick < 999, "maintenance did not quiesce");
                }
                transcript.insert(format!("{n}/sequence"), json!(sequence));
                transcript.insert(
                    format!("{n}/changes"),
                    json!(e.changes(base, 10000).unwrap()),
                );
                let pages = stream(&mut e, &self.principal, &mut watermark, now, self.page_size);
                transcript.insert(format!("{n}/stream"), json!(pages));
                // Re-fetch older puts against the latest authorized row image.
                transcript.insert(
                    format!("{n}/refreshed-stream"),
                    json!(stream(&mut e, &self.principal, &mut base.clone(), now, self.page_size)),
                );
                transcript.insert(
                    format!("{n}/device"),
                    device(world, &mut e, "stream", &pages, now),
                );
                observe_queries(
                    &mut e,
                    &self.principal,
                    &self.queries,
                    &format!("{n}"),
                    &mut transcript, now,
                );
                let pages = snapshot(&mut e, &self.principal, now, self.page_size);
                transcript.insert(format!("{n}/snapshot"), json!(pages));
                transcript.insert(
                    format!("{n}/reacquired-device"),
                    device(world, &mut e, "snapshot", &pages, now),
                );
            }
            transcript
        });
        let differences = differences(&worlds[0], &worlds[1]);
        assert!(
            differences.is_empty(),
            "observable differences:\n{}",
            differences.join("\n")
        );
        worlds[0].clone()
    }
}
pub fn differences(a: &Transcript, b: &Transcript) -> Vec<String> {
    a.keys()
        .chain(b.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|key| {
            serde_json::to_vec(&a.get(*key)).unwrap() != serde_json::to_vec(&b.get(*key)).unwrap()
        })
        .map(|key| format!("{key}: {} <> {}", short(&a.get(key)), short(&b.get(key))))
        .collect()
}
fn short(value: &impl serde::Serialize) -> String {
    let text = serde_json::to_string(value).unwrap();
    if text.len() > 2500 {
        format!("{}... ({} bytes)", &text[..2500], text.len())
    } else {
        text
    }
}
pub fn inputs(e: &Engine, op: &str, args: &Json) -> BTreeMap<String, Value> {
    let p = e.programs().find(|p| p.name == op).unwrap();
    p.args
        .iter()
        .map(|(name, kind)| {
            (
                name.clone(),
                wire::from_json(kind, args.get(name).unwrap_or(&Json::Null)).unwrap(),
            )
        })
        .collect()
}
pub fn observe_queries(
    e: &mut Engine,
    who: &str,
    args: &BTreeMap<String, Json>,
    phase: &str,
    out: &mut Transcript,
    now: i64,
) {
    let names = e
        .programs()
        .filter(|p| p.kind == ProgramKind::Query)
        .map(|p| p.name.clone())
        .collect::<Vec<_>>();
    for name in names {
        let mut input = args.get(&name).cloned().unwrap_or(json!({}));
        for page in 0..100 {
            let context = Context::new(who, inputs(e, &name, &input)).at(now);
            let result = e.query(&name, context);
            out.insert(
                format!("{phase}/query/{name}/{page}"),
                serde_json::to_value(&result).unwrap(),
            );
            let next = result.as_ref().ok().and_then(|r| r.next.clone());
            if let Some(next) = next {
                assert!(input.get("c").is_some(), "missing cursor input for {name}");
                input["c"] = json!(next);
            } else {
                break;
            }
            assert!(page < 99, "cursor did not terminate");
        }
    }
}
pub fn snapshot(e: &mut Engine, who: &str, now: i64, size: usize) -> Vec<Json> {
    let mut pages = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let p = e
            .snapshot_acquisition_page_at(who, after.as_deref(), size, now)
            .unwrap();
        let next = p.next.map(|n| n.encode());
        pages.push(json!({"snapshot":true,"after":after,"held":p.held,"acquisitions":p.acquisitions,
            "events":p.events.iter().map(|v|json!({"table":v.table,"kind":v.kind.word(),"id":v.id,"data":v.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>(),
            "watermark":p.watermark,"more":next.is_some(),"next":next,"generation":e.generation()}));
        after = next;
        if after.is_none() {
            break;
        }
        assert!(pages.len() < 10000);
    }
    pages
}
pub fn stream(e: &mut Engine, who: &str, watermark: &mut u64, now: i64, size: usize) -> Vec<Json> {
    let mut pages = Vec::new();
    loop {
        let p = e.stream_at(who, *watermark, size, now).unwrap();
        pages.push(json!({"snapshot":false,"requested_watermark":*watermark,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,
            "events":p.events.iter().map(|v|json!({"table":v.table,"kind":v.kind,"id":v.id,"data":v.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>(),
            "watermark":p.watermark,"more":p.more,"generation":e.generation()}));
        *watermark = p.watermark;
        if !p.more {
            break;
        }
        assert!(pages.len() < 10000);
    }
    pages
}
