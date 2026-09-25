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
    count += visit_blind_parents(&mut run);
    count += visit_formerly_live(&mut run);
    count += visit_interleaved(&mut run);
    count += visit_evolution(&mut run);
    count += visit_alternatives(&mut run);
    count + visit_value_witness(run)
}

/// Public source × blind non-owner writer × private parent × unequal groups.
/// Both worlds have exactly the same public populations; only the private
/// member's parent differs. Rotate writers, owners, observers and senders.
pub fn visit_blind_parents(mut run: impl FnMut(String, Pair)) -> usize {
    let mut count = 0;
    for populations in POPULATIONS.windows(2).map(|w| [w[0], w[1]])
        .chain(std::iter::once([1, 1200])) {
        for (writer, owner, third) in [("alice", "bob", "carol"), ("bob", "carol", "alice"), ("carol", "alice", "bob")] {
            for observer in [writer, third] {
                for sender in [writer, owner, third] {
                    let pair = public_private_parent(populations, writer, owner, observer, sender);
                    run(format!("public-private-parent/{populations:?}/writer-{writer}/owner-{owner}/observer-{observer}/sender-{sender}"), pair);
                    count += 1;
                }
            }
        }
    }
    count
}

pub fn public_private_parent(populations: [usize; 2], writer: &str, owner: &str, observer: &str, sender: &str) -> Pair {
    let seeds = ["c", "d"].map(|parent| {
        let mut member = cases::member("private-member", owner, 0);
        member.1["conversationId"] = json!(parent);
        let mut visible = cases::member("observer-member", observer, 0);
        visible.1["conversationId"] = json!("remote");
        let mut seed = vec![member, visible];
        for (parent, population) in ["c", "d"].into_iter().zip(populations) {
            for n in 0..population {
                let mut message = cases::message(&format!("{parent}{n:05}"), 5, false);
                message.1["conversationId"] = json!(parent);
                message.1["senderId"] = json!(sender);
                seed.push(message);
            }
        }
        seed
    });
    let mut pair = Pair::new(cases::private_members().replace("  expire at .until\n", ""), seeds, observer,
        Operation::new("mark", json!({"member":"private-member","readUpTo":10}), writer))
        .query("unreadFor", json!({"member":"observer-member"}));
    pair.write_refusal = Some("E_VIEW_KEY");
    pair.page_size = 256;
    pair
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

/// Unswept inputs were live at insertion and are absent at the observation clock.
/// Include payloads that never contributed, so the pending/traffic oracle cannot
/// mistake this for a permissible difference in the disclosed count.
pub fn visit_formerly_live(mut run: impl FnMut(String, Pair)) -> usize {
    for excluded in ["counted", "tombstone", "own-send"] {
      for member_first in [true,false] {
        let seeds = [0,1200].map(|population| {
            let mut rows = vec![cases::member("a","alice",0),cases::message("live",100,false)];
            for i in 0..population {
                let mut row=cases::message(&format!("expired{i:05}"),5,excluded=="tombstone");
                row.1["until"]=json!(NOW+1);
                if excluded=="own-send" {row.1["senderId"]=json!("alice");}
                rows.push(row);
            }
            if !member_first { let member=rows.remove(0); rows.push(member); }
            rows
        });
        let source=cases::SOURCE.to_owned()+"\nmutation useCount(member: members):\n  return unread[member]\n";
        let mut pair=Pair::new(source,seeds,"alice",Operation::new("mark",json!({"member":"a","readUpTo":100}),"alice"))
            .then(Operation::new("useCount",json!({"member":"a"}),"alice"))
            .query("unreadFor",json!({"member":"a"}));
        pair.observed_at=NOW+2;
        for op in &mut pair.operations {op.now=NOW+2;}
        pair.page_size=256;
        run(format!("formerly-live/{excluded}/0-1200/member-first-{member_first}"),pair);
      }
    }
    6
}

/// Expired prefix -> member -> live suffix -> expiry -> read before any mark.
pub fn visit_interleaved(mut run: impl FnMut(String, Pair)) -> usize {
    let mut count = 0;
    for excluded in ["counted", "tombstone", "own-send"] {
        for live in [0, 1, 1023, 1024, 1200] {
            let seeds = [0,1200].map(|population| {
                let mut rows = Vec::new();
                for n in 0..population {
                    let mut row = cases::message(&format!("expired{n:05}"),5,excluded == "tombstone");
                    row.1["until"] = json!(NOW+1);
                    if excluded == "own-send" { row.1["senderId"] = json!("alice"); }
                    rows.push(row);
                }
                rows.push(cases::member("a","alice",0));
                rows.extend((0..live).map(|n|cases::message(&format!("live{n:05}"),100,false)));
                rows
            });
            let mut pair = Pair::new(cases::SOURCE.to_owned()+"\nmutation useCount(member: members):\n  return unread[member]\n", seeds, "alice", Operation::new("useCount",json!({"member":"a"}),"alice"))
                .query("unreadFor",json!({"member":"a"}));
            pair.observed_at=NOW+2; pair.operations[0].now=NOW+2; pair.page_size=256;
            run(format!("interleaved/{excluded}/expired-0-1200/live-{live}/read-before-mark"),pair);
            count+=1;
        }
    }
    count
}

/// Every schema transition operates on actual legacy rows, not rows rewritten
/// with explicit defaults. The harness checks each adopted stored count too.
pub fn visit_evolution(mut run: impl FnMut(String, Pair)) -> usize {
    let mut count = 0;
    for change in ["adopt", "expiry-default", "expiry-field", "member-default"] {
        for sweep in [false,true] {
            let final_source = cases::SOURCE.to_owned()+"\nmutation useCount(member: members):\n  return unread[member]\n";
            let mut source = final_source.split("view unread:").next().unwrap().to_owned();
            let mut member = cases::member("a","alice",0);
            let mut message = cases::message("legacy",5,false);
            message.1.as_object_mut().unwrap().remove("until");
            source=source.replace("  until: time ?\n  expire at .until\n", "");
            let first = final_source.replace("  until: time ?", "  until: time default 1001").replace("until: time ?)", "until: time)");
            let second = match change {
                "expiry-default" => first.replace("until: time default 1001", "until: time default 1020"),
                "expiry-field" => first.replace("  expire at .until", "  later: time default 1020\n  expire at .later"),
                "member-default" => first.replace("readUpTo: int default 0", "readUpTo: int default 10").replace("until: time default 1001", "until: time default 1020"),
                _ => first.clone(),
            };
            let first = if change == "member-default" {
                member.1.as_object_mut().unwrap().remove("readUpTo");
                source=source.replace("  readUpTo: int default 0\n", "");
                first.replace("until: time default 1001", "until: time default 1020")
            } else { first };
            let rows=vec![member,message];
            let mut pair=Pair::new(source,[rows.clone(),rows],"alice",Operation::new("useCount",json!({"member":"a"}),"alice"))
                .query("unreadFor",json!({"member":"a"}));
            pair.adoptions.push((first,NOW+2));
            if change != "adopt" {pair.adoptions.push((second,NOW+3));}
            pair.observed_at=if sweep {NOW+21} else {NOW+3};
            pair.operations[0].now=pair.observed_at;
            if sweep {pair.sweep_at=Some(pair.observed_at);}
            run(format!("evolution/{change}/sweep-{sweep}"),pair);count+=1;
        }
    }
    count
}

/// Private witness deadlines vary while a logical alternative keeps the full
/// authorization verdict unchanged. Include correlated/not and two witnesses.
pub fn visit_alternatives(mut run: impl FnMut(String, Pair)) -> usize {
    let mut count = 0;
    for control in [false,true] {
        let a=if control {"exists members[id = .member]"} else {"exists unread[member = .member]"};
        let b=if control {"exists members[id = .backup]"} else {"exists unread[member = .backup]"};
        for rule in [format!("{a} or viewer = 'alice'"), format!("viewer = 'alice' or {a}"), format!("{a} or {b}"),format!("{b} or {a}"),format!("{a} or not {a}"),format!("not ({a} and not {a})"),format!("({a} and viewer = 'nobody') or viewer = 'alice'")] {
            let source=cases::private_members().replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  deadline: time ?\n  expire at .deadline")
                + &format!("\ntable gates:\n  member: members\n  backup: members\n  read <- {rule}\n  insert <- {rule}\n  online only\nquery gate():\n  return gates['gate']\nmutation attempt():\n  insert gates {{ id: 'attempt', member: 'b', backup: 'c' }}\n");
            let seeds=[NOW+1,NOW+100].map(|until| {
                let mut member=cases::member("b","bob",0);member.1["deadline"]=json!(until);
                let mut backup=cases::member("c","carol",0);backup.1["deadline"]=json!(NOW+200);
                vec![cases::member("a","alice",0),member,backup,("gates".into(),json!({"id":"gate","member":"b","backup":"c"}))]
            });
            let pair=Pair::new(source,seeds,"alice",Operation::new("attempt",json!({}),"alice")).query("unreadFor",json!({"member":"a"}));
            run(format!("witness-alternative/control-{control}/{rule}"),pair);count+=1;
        }
    }
    count
}

/// Grok G1: value-equality witnesses must certify, never compare the stored
/// total. G2: the same observer spans both live expiry-index ranges and a gap.
pub fn visit_value_witness(mut run: impl FnMut(String, Pair)) -> usize {
    let mut count=0;
    for expired in [1,1200] {
        for mixed in [false,true] {
            let live=if mixed {1200} else {1};
            let seeds=[0,expired].map(|population| {
                let mut rows=vec![cases::member("a","alice",0)];
                for n in 0..population {
                    let mut row=cases::message(&format!("expired{n:05}"),5,false);
                    row.1["until"]=json!(NOW+1);rows.push(row);
                }
                for n in 0..live {
                    let mut row=cases::message(&format!("live{n:05}"),100,false);
                    if mixed && n>=600 {row.1["until"]=json!(NOW+100);}
                    rows.push(row);
                }
                rows
            });
            let source=cases::SOURCE.to_owned()+&format!("\nquery valueWitness(member: members):\n  return exists unread[member = member, value = {live}]\nmutation useCount(member: members):\n  return unread[member]\n");
            let mut pair=Pair::new(source,seeds,"alice",Operation::new("useCount",json!({"member":"a"}),"alice"))
                .then(Operation::new("mark",json!({"member":"a","readUpTo":1}),"alice"))
                .query("unreadFor",json!({"member":"a"})).query("valueWitness",json!({"member":"a"}));
            pair.page_size=256;pair.observed_at=NOW+2;
            for op in &mut pair.operations {op.now=NOW+2;}
            run(format!("value-witness/expired-0-{expired}/mixed-ranges-{mixed}"),pair);count+=1;
        }
    }
    count
}
