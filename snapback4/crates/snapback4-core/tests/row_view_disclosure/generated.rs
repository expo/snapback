//! Scenario axes produce populations and operation histories, not a case list.
//! Restricted mismatched audiences are admission regressions under the interim fence.
use super::*;
#[derive(Clone, Copy, Debug)]
enum Rule { Access, AlignedAccess, Sender, Deny, Inherited, Public }
#[derive(Clone, Copy, Debug)]
struct Transition { moved: bool, readable: [bool; 2] }
#[derive(Clone, Copy, Debug)]
enum Expiry { None, BeforeWatermark, AfterWatermark }
const POPULATIONS: [usize; 5] = [0, 1, 2, 1200, 10000];
fn source(rule: Rule) -> String {
    let (read, sync) = match rule {
        Rule::Access => ("exists access[.conversationId, viewer]", "online only"),
        Rule::AlignedAccess => ("exists access[.conversationId, viewer]", "sync to access[.conversationId]"),
        Rule::Sender => (".senderId = viewer", "sync to .senderId"),
        Rule::Deny => ("deny", "online only"),
        Rule::Inherited => ("exists members[.conversationId, viewer]", "online only"),
        Rule::Public => ("allow", "sync public"),
    };
    let mut s = cases::private_members()
        .replace("  expire at .until\n  read <- allow", &format!("  expire at .until\n  read <- {read}"))
        .replace("  sync public\nview unread", &format!("  {sync}\nview unread"));
    if matches!(rule, Rule::AlignedAccess) {
        s = s.replace("  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal", "  read <- exists access[.conversationId, viewer]\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to access[.conversationId]");
    }
    s.push_str("\ntable access:\n  conversationId: conversations\n  principal: principal\n  unique conversationId, principal\n  read <- .principal = viewer\n  sync to .principal\nmutation moveMember(member: members, parent: conversations):\n  update members[member] { conversationId: parent }\nquery sourceRows():\n  return messages where .conversationId = 'c' first 100\n");
    s
}
fn scenario(rule: Rule, transition: Transition, expiry: Expiry, populations: [usize; 2], destination: usize) -> Pair {
    let refused = matches!(rule, Rule::Access | Rule::Sender | Rule::Deny);
    let grants = ["c", "d"].into_iter().zip(transition.readable)
        .filter_map(|(parent, readable)| readable.then_some(parent)).collect::<Vec<_>>();
    let seeds = populations.map(|population| {
        let mut seed = vec![cases::member("a", "alice", 0)];
        for parent in &grants {
            seed.push(("access".into(), json!({"id":format!("grant-{parent}"),"conversationId":parent,"principal":"alice"})));
        }
        // In admitted inherited worlds, the hidden live population is outside
        // Alice's member group. Born-expired inputs also vary inside her groups.
        // Independent access/sender/deny worlds exercise the rejected broader audience.
        for n in 0..population {
            let mut row = cases::message(&format!("hidden{n:05}"), 5, false);
            if matches!(rule, Rule::AlignedAccess) {
                row.1["conversationId"] = json!(if !transition.readable[0] { "c" } else if !transition.readable[1] { "d" } else { "remote" });
            } else if !refused { row.1["until"] = json!(NOW - 1); }
            seed.push(row);
            if matches!(rule, Rule::Inherited) {
                let mut hidden = cases::message(&format!("remote{n:05}"), 5, false);
                hidden.1["conversationId"] = json!("remote");
                seed.push(hidden);
            }
        }
        for (parent, size) in [("c", 5), ("d", destination)] {
            for n in 0..size {
                let mut row = cases::message(&format!("{parent}{n:05}"), 10, false);
                row.1["conversationId"] = json!(parent);
                // The same visible rows expire before/after the initial watermark
                // in both worlds. No unequal history is erased by the observer.
                if n == 0 {
                    row.1["until"] = match expiry {
                        Expiry::None => Json::Null,
                        Expiry::BeforeWatermark => json!(NOW - 1),
                        Expiry::AfterWatermark => json!(NOW + 1),
                    };
                }
                seed.push(row);
            }
        }
        seed
    });
    for (world, seed) in seeds.iter().enumerate() {
        assert_eq!(seed.iter().filter(|(t,r)| t == "messages" && r["id"].as_str().unwrap().starts_with("hidden")).count(), populations[world]);
    }
    assert_ne!(populations[0], populations[1]);
    let mut source = source(rule);
    if matches!(rule, Rule::AlignedAccess) && matches!(expiry, Expiry::None) {
        source = source.replace("  expire at .until\n", "");
    }
    let mut pair = Pair::new(source, seeds, "alice", Operation::new("mark", json!({"member":"a","readUpTo":1}), "alice"))
        .query("unreadFor", json!({"member":"a"}));
    if transition.moved {
        pair.operations.push(Operation::new("moveMember", json!({"member":"a","parent":"d"}), "alice"));
        pair.operations.push(Operation::new("moveMember", json!({"member":"a","parent":"c"}), "alice"));
    }
    pair.operations.push(Operation::new("mark", json!({"member":"a","readUpTo":11}), "alice"));
    for (n, op) in pair.operations.iter_mut().enumerate() { op.now = NOW + n as i64 + 2; }
    pair.refused = refused;
    pair.page_size = 256;
    pair
}
/// Adjacent buckets plus the reviewers' 1/1200 cross-boundary probe. Every rule
/// receives all five populations, all transitions, and all three expiry clocks.
/// Public and inherited sources additionally exercise a pending destination.
pub fn visit(mut run: impl FnMut(String, Pair)) -> usize {
    let edges = POPULATIONS.windows(2).map(|w| [w[0], w[1]]).chain(std::iter::once([1, 1200]));
    let mut count = 0;
    for populations in edges {
        for rule in [Rule::Access, Rule::AlignedAccess, Rule::Sender, Rule::Deny, Rule::Inherited, Rule::Public] {
            // Generate the directed graph on two parent visibility states.
            let moves = [false, true].into_iter().flat_map(|from|
                [false, true].into_iter().map(move |to| Transition { moved: true, readable: [from, to] }));
            for transition in std::iter::once(Transition { moved: false, readable: [true,true] }).chain(moves) {
                // Inherited membership grants access when the member moves; public
                // groups are always readable. Those have one meaningful move class.
                if matches!(rule, Rule::Inherited | Rule::Public)
                    && transition.readable != [true, true] { continue; }
                for expiry in [Expiry::None, Expiry::BeforeWatermark, Expiry::AfterWatermark] {
                    let destinations: &[usize] = if transition.moved && transition.readable == [true, true] { &[2, 1200] } else { &[2] };
                    for &destination in destinations {
                        let name = format!("{rule:?}/{transition:?}/{expiry:?}/{populations:?}/to-{destination}");
                        count += 1;
                        run(name, scenario(rule, transition, expiry, populations, destination));
                    }
                }
            }
        }
    }
    count
}
/// Exact Astra scratch inputs are retained, now as admission counterexamples.
pub fn astra_schedule() -> Pair {
    let mut pair = cases::hidden_interval();
    pair.seeds = [1, 1200].map(|count| {
        let mut seed = vec![cases::member("a", "alice", 0)];
        seed.extend((0..count).map(|n| cases::message(&format!("hidden{n:04}"), 5, false)));
        seed
    });
    pair
}
pub fn astra_move() -> Pair {
    let mut pair = scenario(Rule::Access, Transition { moved: true, readable: [false, true] }, Expiry::None, [1, 2], 1200);
    pair.operations = vec![Operation::new("moveMember",json!({"member":"a","parent":"d"}),"alice")];
    // Match scratch: the old conversation contains only 1 or 2 hidden rows.
    for seed in &mut pair.seeds { seed.retain(|(t,r)| t != "messages" || !r["id"].as_str().unwrap().starts_with('c')); }
    pair
}

pub fn grok_born_expired(population: usize, examined: Option<u64>) -> Pair {
    let seeds = [0, population].map(|count| {
        let mut seed = vec![cases::member("a", "alice", 0), cases::message("live", 5, false)];
        for n in 0..count {
            let mut row = cases::message(&format!("born-expired{n:05}"), 5, false);
            row.1["until"] = json!(NOW - 1);
            seed.push(row);
        }
        seed
    });
    let mut pair = Pair::new(cases::SOURCE.to_owned() + "\nmutation useCount(member: members):\n  return unread[member]\nquery visibleMessages():\n  return messages first 100\n", seeds, "alice", Operation::new("useCount",json!({"member":"a"}),"alice"))
        .query("unreadFor", json!({"member":"a"}));
    pair.examined = examined;
    pair
}

pub fn aligned_access_hidden_mark() -> Pair {
    scenario(Rule::AlignedAccess, Transition { moved: true, readable: [false,false] }, Expiry::None, [1,1200], 2)
}

pub fn blind_private_parent() -> Pair {
    let seeds = ["c", "d"].map(|parent| {
        let mut private = cases::member("b", "bob", 0);
        private.1["conversationId"] = json!(parent);
        vec![cases::member("a", "alice", 0), private, cases::message("live", 5, false)]
    });
    Pair::new(source(Rule::Inherited), seeds, "alice", Operation::new("mark",json!({"member":"b","readUpTo":1}),"alice"))
        .query("unreadFor",json!({"member":"b"}))
}
