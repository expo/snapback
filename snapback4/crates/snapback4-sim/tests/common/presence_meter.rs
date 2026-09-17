// Shared by simulator and both real device-store prediction witnesses.
// The numeric I1 bound applies without a ticketed statement + hedged arm mix.
pub fn assert_i1(label: &str, held: [u64; 7], graced: [u64; 7], prediction: [u64; 7]) {
    println!("w15a5 I1 {label}: held={held:?} graced={graced:?} prediction={prediction:?}");
    for (i, field) in ["examined", "index_entries", "rule_probes", "steps", "heap_bytes", "output_bytes", "rows_written"].into_iter().enumerate() {
        assert!(held[i] <= prediction[i].max(graced[i]), "I1 {label}: {field} held {} > max(prediction {}, graced {})", held[i], prediction[i], graced[i]);
    }
}

pub fn prediction_meter<S: snapback4_device::store::DeviceStore>(store: &mut S, schema: &snapback4_core::schema::Schema, program: &snapback4_core::ir::Program, context: snapback4_core::Context) -> Vec<(&'static str, u64)> {
    use snapback4_device::store::DeviceTx;
    use snapback4_core::{Ceilings, engine::local};
    // Measure every counter through the real prediction entry point:
    // its exact minimum accepting ceiling is the amount it charges.
    let tx = store.transaction().unwrap();
    let full = local::predict(&tx, schema, program, context.clone(), Ceilings::default());
    tx.rollback().unwrap();
    assert!(full.is_ok(), "the measured prediction must fit the ordinary ceilings: {full:?}");
    let mut measured = Vec::new();
    for field in ["examined", "index_entries", "rule_probes", "steps", "heap_bytes", "output_bytes", "rows_written"] {
        let mut low = 0;
        let limits = Ceilings::default();
        let mut high = match field {
            "examined" => limits.examined, "index_entries" => limits.index_entries,
            "rule_probes" => limits.rule_probes, "steps" => limits.steps,
            "heap_bytes" => limits.heap_bytes, "output_bytes" => limits.output_bytes,
            "rows_written" => limits.rows_written, _ => unreachable!(),
        };
        while low < high {
            let mid = (low + high) / 2;
            let mut limits = Ceilings::default();
            match field {
                "examined" => limits.examined = mid,
                "index_entries" => limits.index_entries = mid,
                "rule_probes" => limits.rule_probes = mid,
                "steps" => limits.steps = mid,
                "heap_bytes" => limits.heap_bytes = mid,
                "output_bytes" => limits.output_bytes = mid,
                "rows_written" => limits.rows_written = mid,
                _ => unreachable!(),
            }
            let tx = store.transaction().unwrap();
            let accepted = local::predict(&tx, schema, program, context.clone(), limits).is_ok();
            tx.rollback().unwrap();
            if accepted { high = mid; } else { low = mid + 1; }
        }
        measured.push((field, low));
    }
    measured
}

pub fn inherited_excess_witness<S: snapback4_device::store::DeviceStore>(mut store: S, label: &str) {
    use snapback4_core::{Context, Engine, Presence, Value, engine::WriteState};
    #[derive(Debug)]
    struct Poll(u64, i64);
    impl Presence for Poll {
        fn connections(&self, _: &str) -> u64 { self.0 }
        fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (self.0, Some(self.1)) }
    }
    let conjunction = "effect notify\nmutation push(p: principal, q: principal):\n  if not exists connected[p] and not exists connected[q]:\n    emit notify {}\n";
    let composition = format!("{conjunction}  if exists connected[p]:\n    emit notify {{}}\n");
    let mut triples = Vec::new();
    for (name, source, hedged) in [("conjunction", conjunction, false), ("composition", composition.as_str(), true)] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(bound.schema.operations["push"].predicts.as_deref(), Some("eligible"));
        store.install(&bound.schema, &Default::default(), false).unwrap();
        let ctx = || Context::new("alice", [("p".into(), Value::Id("bob".into())), ("q".into(), Value::Id("carol".into()))].into()).at(11_000);
        let program = &bound.programs.iter().find(|p| p.program.name == "push").unwrap().program;
        let predicted = prediction_meter(&mut store, &bound.schema, program, ctx());
        let prediction: [u64; 7] = std::array::from_fn(|i| predicted[i].1);
        let mut meters = Vec::new();
        for (live, deadline) in [(1, 16_000), (0, 36_000)] {
            let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
            engine.set_presence(Some(std::sync::Arc::new(Poll(live, deadline))));
            let sent = engine.mutate("push", None, ctx()).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
            let effects = engine.effects(None, 10).unwrap();
            assert_eq!(effects.len(), 1 + usize::from(hedged && live > 0));
            assert_eq!(effects.iter().filter(|e| e.next_at == Some(deadline)).count(), 1);
            assert_eq!(effects.iter().filter(|e| e.next_at.is_none()).count(), usize::from(hedged && live > 0));
            let m = sent.metered;
            meters.push([m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written]);
        }
        println!("w15a6 inherited excess {label}/{name}: held={:?} graced={:?} prediction={prediction:?}", meters[0], meters[1]);
        triples.push([meters[0], meters[1], prediction]);
    }
    for (i, field) in ["examined", "index_entries", "rule_probes", "steps", "heap_bytes", "output_bytes", "rows_written"].into_iter().enumerate() {
        let isolated = i128::from(triples[0][0][i]) - i128::from(triples[0][2][i]);
        let composed = i128::from(triples[1][0][i]) - i128::from(triples[1][2][i]);
        assert_eq!(composed, isolated, "{label}/{field}: composition adds no under-reservation");
        if isolated <= 0 { assert!(composed <= 0, "{label}/{field}: no new excess"); }
    }
}
