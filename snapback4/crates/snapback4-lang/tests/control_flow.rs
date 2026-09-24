//! Random small Quarry programs must not turn accepted types into runtime E_TYPE.
use snapback4_core::{Context, Engine, Value};
use snapback4_lang::compile;

struct Generator(u64);
impl Generator {
    fn pick(&mut self, count: usize) -> usize {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 32) as usize) % count
    }

    fn condition(&mut self) -> &'static str {
        ["ready", "stop", "third", "not ready", "x != null", "x = null", "true", "false"][self.pick(8)]
    }

    fn block(&mut self, indent: usize, depth: usize, in_loop: bool, budget: &mut usize) -> String {
        let mut source = String::new();
        let pad = " ".repeat(indent);
        for _ in 0..1 + self.pick(4) {
            if *budget == 0 { break; }
            *budget -= 1;
            let choice = self.pick(if depth > 0 { 10 } else { 8 });
            match choice {
                0 => source.push_str(&format!("{pad}x = null\n")),
                1 => source.push_str(&format!("{pad}x = {}\n", self.pick(5))),
                2 => source.push_str(&format!("{pad}x = x + 1\n")),
                3 => source.push_str(&format!("{pad}observed = x + 1\n")),
                4 => source.push_str(&format!("{pad}require {} else STOP\n", self.condition())),
                5 => source.push_str(&format!("{pad}return {}\n", ["0", "x", "x + 1"][self.pick(3)])),
                6 if in_loop => source.push_str(&format!("{pad}break\n")),
                7 if in_loop => source.push_str(&format!("{pad}continue\n")),
                8 => {
                    source.push_str(&format!("{pad}if {}:\n", self.condition()));
                    source.push_str(&self.block(indent + 2, depth - 1, in_loop, budget));
                    if self.pick(2) == 0 {
                        source.push_str(&format!("{pad}else:\n"));
                        source.push_str(&self.block(indent + 2, depth - 1, in_loop, budget));
                    }
                }
                9 => {
                    source.push_str(&format!("{pad}for n{indent} in {}:\n", ["[]", "[1]", "[1, 2]"][self.pick(3)]));
                    source.push_str(&self.block(indent + 2, depth - 1, true, budget));
                }
                _ => source.push_str(&format!("{pad}x = x ?? 0\n")),
            }
        }
        // An exhausted generation budget must still produce a valid block.
        if source.is_empty() { source.push_str(&format!("{pad}x = 1\n")); }
        source
    }
}

#[test]
fn random_clean_programs_never_fail_with_a_runtime_type_error() {
    let mut accepted = 0;
    let mut refused = 0;
    let mut answers = 0;
    let mut stops = 0;
    // Fixed seeds make failures reproducible; all eight boolean inputs run for
    // every admitted program, including untaken branches and loop iterations.
    for seed in [1, 0x3000_013, 0xdead_beef, 0x5eed_12] {
        let mut generator = Generator(seed);
        for case in 0..512 {
            let mut budget = 24;
            // Bias a quarter of cases toward a nullable write followed by
            // competing loop/function exits; unrestricted blocks fill the rest.
            let body = if case % 4 == 0 {
                let middle = generator.block(6, 2, true, &mut budget);
                let tail = ["return 0", "require false else STOP"][generator.pick(2)];
                format!("  for outer in [1, 2]:\n    if ready:\n      x = null\n{middle}      {tail}\n")
            } else if case % 2 == 0 {
                format!("  for outer in [1, 2]:\n{}", generator.block(4, 3, true, &mut budget))
            } else { generator.block(2, 3, false, &mut budget) };
            let source = format!("query run(ready: bool, stop: bool, third: bool):\n  x = 1\n{body}  return x + 1\n");
            let bound = compile(&[("schema.q".into(), source.clone())]);
            assert!(!bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX"), "seed={seed}, case={case}\n{source}\n{:?}", bound.diagnostics);
            if !bound.diagnostics.is_empty() { refused += 1; continue; }
            accepted += 1;
            let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            for inputs in 0..8 {
                let args = ["ready", "stop", "third"].into_iter().enumerate()
                    .map(|(bit, name)| (name.into(), Value::Bool(inputs & (1 << bit) != 0))).collect();
                match engine.query("run", Context::new("alice", args)) {
                    Ok(_) => answers += 1,
                    Err(error) => {
                        assert_eq!(error.code, "STOP", "seed={seed}, case={case}, inputs={inputs}\n{source}\n{error:?}");
                        stops += 1;
                    }
                }
            }
        }
    }
    assert!(accepted > 100 && refused > 100 && answers > 100 && stops > 100,
        "non-vacuous coverage: {accepted} accepted, {refused} refused, {answers} answers, {stops} stops");
    println!("flow property: {accepted} accepted, {refused} refused, {answers} answers, {stops} named refusals");
}
