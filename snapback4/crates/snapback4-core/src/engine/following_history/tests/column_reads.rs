//! A staged/replayed card is not a historical grant to an undelivered cell.
// @ref LLP 3000.026#92-frozen-domain-identity-and-current-authority — authority loss restarts a pinned unit.
// @ref LLP 3000.036#224-assets-writes-and-refusals — the payload's column grant applies on every publication path.
use super::*;

fn protected(rule: &str) -> Engine {
    protected_source(rule, false)
}
fn protected_source(rule: &str, through: bool) -> Engine {
    let rule = if through { ".noteOwner = viewer" } else { rule };
    let source=SOURCE.replace("  authorId: principal\n", &format!("  authorId: principal\n  noteOwner: principal\n  note: text <=80 ? read <- {rule}\n"))
        .replace("authorId: viewer, parentId", "authorId: viewer, noteOwner: viewer, parentId")
        .replace("return feed last 20 by .at after c {", "return feed last 4 by .at after c {")
        + "\nmutation moveNote(post: posts, owner: principal):\n  update posts[post] { noteOwner: owner }\ntable grants:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n";
    let source = if through {
        source.replace("post: posts[.post]", "post: children[parent = .post]")
            .replace("update posts[post] { noteOwner: owner }", "update children[parent = post] { noteOwner: owner, gate: false }")
            + "\ntable children:\n  parent: posts\n  unique parent\n  gate: bool default true\n  noteOwner: principal\n  note: text <=80 ? read <- .gate = true\n  immutable parent\n  read through .parent\n  update <- allow\n  online only\n"
    } else { source };
    let initial = source
        .replace(
            "view feed: activity where .actor = viewer or exists follows[viewer, .actor]\n",
            "",
        )
        .replace("return feed last", "return activity last");
    let (schema, programs) = compiled(&initial);
    let mut e = Engine::memory(schema, programs).unwrap();
    let mut rows = Vec::new();
    for n in 0..6 {
        let (table, mut row) = post(&format!("p{n}"), "reader", n);
        let Value::Row(fields) = &mut row else {
            unreachable!()
        };
        fields.insert("noteOwner".into(), id("reader"));

        fields.insert(
            "note".into(),
            Value::String("never publish after revocation".into()),
        );
        if through { rows.push(("children".into(), object([("id",id(format!("p{n}"))), ("parent",id(format!("p{n}"))), ("gate",Value::Bool(true)), ("noteOwner",id("reader")), ("note",Value::String("never publish after revocation".into()))]))); }
        rows.push((table, row));
    }
    rows.push((
        "grants".into(),
        object([("id", id("grant")), ("principal", id("reader"))]),
    ));
    e.seed_at(rows, 100).unwrap();
    let (schema, programs) = compiled(&source);
    e.adopt_at(schema, programs, 1_000_000).unwrap();
    e
}
fn context() -> Context {
    Context::new("reader", BTreeMap::new()).at(1_000_000)
}
fn open(r: &mut Reader, e: &Engine) -> Request {
    r.opening_projected(e, "cards", context()).unwrap().request
}
fn next(r: &mut Reader, e: &mut Engine, q: &Request) -> Outcome {
    r.request_projected(e, q.clone(), context(), "cards")
        .unwrap()
}
fn revoke(e: &mut Engine, local: bool) {
    if local {
        for n in 0..6 {
            mutation(
                e,
                "moveNote",
                "reader",
                [("post", id(format!("p{n}"))), ("owner", id("other"))],
                1_000_000,
            );
        }
    } else {
        e.seed_delete_at("grants", "grant", 1_000_000).unwrap();
    }
}

#[test]
fn column_grants_are_rechecked_for_unchanged_replay_and_mounted_refresh() {
    for (local, rule) in [
        (true, ".noteOwner = viewer"),
        (false, "exists grants[viewer]"),
    ] {
        let mut e = protected(rule);
        let mut r = Reader::new().unwrap();
        let q = open(&mut r, &e);
        let first = next(&mut r, &mut e, &q);
        assert!(
            matches!(first.answer.response, Response::Page { .. }),
            "{}",
            first.answer.bytes()
        );
        assert!(
            first
                .answer
                .bytes()
                .contains("never publish after revocation")
        );
        // The body is intentionally not reloaded while authorizing saved bytes.
        assert_eq!(
            next(&mut r, &mut e, &q).answer.bytes(),
            first.answer.bytes()
        );
        let Response::Page { items, .. } = &first.answer.response else {
            unreachable!()
        };
        let mounted = items
            .iter()
            .filter_map(|item| match item {
                Item::Shaped { id, authority, .. } => Some(Mounted {
                    id: id.clone(),
                    live: false,
                    authority: authority.clone(),
                }),
                _ => None,
            })
            .collect::<Vec<_>>();
        revoke(&mut e, local);
        let refreshed = r
            .refresh(&mut e, &q.opening, "cards", context(), &mounted)
            .unwrap();
        assert!(
            !serde_json::to_string(&refreshed)
                .unwrap()
                .contains("never publish")
        );
        match refreshed {
            Refresh::Page { visible, .. } | Refresh::Preparing { visible, .. } => {
                assert!(visible.is_empty())
            }
            other => panic!("{other:?}"),
        }
        let replay = next(&mut r, &mut e, &q);
        assert!(
            matches!(replay.answer.response, Response::Restart),
            "{}",
            replay.answer.bytes()
        );
        assert!(!replay.answer.bytes().contains("never publish"));
    }
}

#[test]
fn column_revocation_between_preparation_and_first_delivery_restarts() {
    for (local, rule) in [
        (true, ".noteOwner = viewer"),
        (false, "exists grants[viewer]"),
    ] {
        let mut witnessed = false;
        for limit in 40..300 {
            let mut e = protected(rule);
            let mut r = Reader::new().unwrap();
            let mut q = open(&mut r, &e);
            e.set_ceilings(Ceilings {
                examined: limit,
                ..Default::default()
            });
            let out = next(&mut r, &mut e, &q);
            if !matches!(out.answer.response, Response::Preparing { .. }) {
                continue;
            }
            let session = &r.sessions[&("reader".into(), q.opening.clone())];
            if session.staged.is_empty() {
                continue;
            }
            assert!(!out.answer.bytes().contains("never publish"));
            q.token = out.answer.response.next().map(str::to_owned);
            e.set_ceilings(Ceilings::default());
            revoke(&mut e, local);
            let after = next(&mut r, &mut e, &q);
            assert!(
                matches!(after.answer.response, Response::Restart),
                "{local} {limit}: {}",
                after.answer.bytes()
            );
            assert!(!after.answer.bytes().contains("never publish"));
            witnessed = true;
            break;
        }
        assert!(witnessed, "no staged preparing unit for {rule}");
    }
}

#[test]
fn through_child_column_selector_is_not_replaced_by_its_granting_default() {
    let mut e = protected_source(".gate = true", true);
    let mut r = Reader::new().unwrap();
    let q = open(&mut r, &e);
    let first = next(&mut r, &mut e, &q);
    assert!(first.answer.bytes().contains("never publish"));
    revoke(&mut e, true);
    assert!(matches!(next(&mut r, &mut e, &q).answer.response, Response::Restart));
}
