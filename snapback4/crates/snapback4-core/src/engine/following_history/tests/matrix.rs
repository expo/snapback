use super::*;

fn seeded(rows: impl IntoIterator<Item = (String, Value)>) -> Engine {
    let mut e = engine();
    e.seed_at(rows, 100).unwrap();
    adopt(&mut e);
    e
}
fn advance(q: &mut Request, out: &Outcome) {
    q.token = out.answer.response.next().map(str::to_owned);
}
fn owned<'a>(r: &'a Reader, q: &Request) -> &'a Session {
    &r.sessions[&("reader".into(), q.opening.clone())]
}

#[test]
fn post_bound_births_and_new_follows_do_not_expand_or_restart_the_domain() {
    let mut e = seeded([edge("a"), post("old-a", "a", 1), post("old-b", "b", 2)]);
    e.set_ceilings(Ceilings {
        examined: 24,
        ..Default::default()
    });
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 2);
    let first = step(&mut r, &mut e, &q);
    assert!(matches!(first.answer.response, Response::Preparing { .. }));
    advance(&mut q, &first);
    e.set_ceilings(Ceilings::default());
    mutation(
        &mut e,
        "post",
        "a",
        [("postId", id("backdated")), ("parentId", Value::Null)],
        0,
    );
    mutation(
        &mut e,
        "post",
        "a",
        [("postId", id("new")), ("parentId", Value::Null)],
        3,
    );
    mutation(&mut e, "follow", "reader", [("actor", id("b"))], 4);
    let (ids, _) = drain(&mut r, &mut e, &mut q, &oracle);
    assert_eq!(ids, vec!["old-a"]);
}

#[test]
fn unfollowed_heads_are_removed_and_staged_revocations_restart() {
    // Cut at each request boundary to exercise a head, the last staged row and
    // an entirely staged page. A restart is explicit; no empty success slips in.
    let mut staged_cases = 0;
    let mut head_cases = 0;
    for limit in 20..70 {
        let mut e = seeded([
            edge("a"),
            edge("b"),
            post("a1", "a", 4),
            post("a0", "a", 3),
            post("b1", "b", 2),
            post("b0", "b", 1),
        ]);
        e.set_ceilings(Ceilings {
            examined: limit,
            ..Default::default()
        });
        let oracle = Oracle::freeze(&e);
        let mut r = Reader::new().unwrap();
        let mut q = request(&mut r, 3);
        let out = step(&mut r, &mut e, &q);
        if !matches!(out.answer.response, Response::Preparing { .. }) {
            continue;
        }
        let s = owned(&r, &q);
        let staged = s.staged.iter().any(|x| x.head.event.actor == "a");
        let has_head = s.frontier.heads > 0;
        if !staged && !has_head {
            continue;
        }
        advance(&mut q, &out);
        e.set_ceilings(Ceilings::default());
        mutation(&mut e, "unfollow", "reader", [("actor", id("a"))], 5);
        let out = step(&mut r, &mut e, &q);
        if staged {
            assert!(matches!(out.answer.response, Response::Restart));
            staged_cases += 1;
        } else {
            match &out.answer.response {
                Response::Page { items, .. } => {
                    oracle.page(&e, items, None);
                    head_cases += 1;
                }
                other => panic!("{other:?}"),
            };
        }
    }
    assert!(
        staged_cases > 0 && head_cases > 0,
        "staged={staged_cases} heads={head_cases}"
    );
}

#[test]
fn changed_declaration_store_generation_and_old_unit_restart_without_eviction() {
    let mut e = seeded((0..12).map(|n| post(&format!("p{n}"), "reader", n)));
    let mut other = seeded([post("foreign", "reader", 0)]);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 1);
    let opening = q.clone();
    let out = step(&mut r, &mut e, &q);
    advance(&mut q, &out);
    let mut wrong = opening.clone();
    wrong.declaration = "missing".into();
    assert!(matches!(
        step(&mut r, &mut e, &wrong).answer.response,
        Response::Restart
    ));
    assert!(matches!(
        step(&mut r, &mut other, &q).answer.response,
        Response::Restart
    ));
    e.generation += 1;
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
    e.generation -= 1;
    for _ in 0..3 {
        let out = step(&mut r, &mut e, &q);
        assert!(matches!(out.answer.response, Response::Page { .. }));
        advance(&mut q, &out);
    }
    assert!(matches!(
        step(&mut r, &mut e, &opening).answer.response,
        Response::Restart
    ));
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Page { .. }
    ));
}

#[test]
fn quota_and_tiny_meter_refusals_leave_the_pending_unit_unchanged() {
    let mut e = seeded((0..120).flat_map(|n| {
        let a = format!("a{n}");
        [edge(&a), post(&format!("p{n}"), &a, n)]
    }));
    e.set_ceilings(Ceilings {
        examined: 64,
        ..Default::default()
    });
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 3);
    let out = step(&mut r, &mut e, &q);
    advance(&mut q, &out);
    let before = r.accounted_bytes();
    let pending = owned(&r, &q).pending_token.clone();
    r.per_session = before;
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Refused {
            code: "E_FOLLOWING_QUOTA"
        }
    ));
    assert_eq!(r.accounted_bytes(), before);
    assert_eq!(owned(&r, &q).pending_token, pending);
    r.per_session = SESSION_BYTES;
    for c in [
        Ceilings {
            rows_written: 4,
            ..Default::default()
        },
        Ceilings {
            rule_probes: 5,
            ..Default::default()
        },
        Ceilings {
            index_entries: 0,
            ..Default::default()
        },
        Ceilings {
            examined: 14,
            ..Default::default()
        },
        Ceilings {
            steps: 100,
            ..Default::default()
        },
        Ceilings {
            heap_bytes: SCRATCH + 1024,
            ..Default::default()
        },
        Ceilings {
            output_bytes: ENVELOPE,
            ..Default::default()
        },
    ] {
        e.set_ceilings(c);
        let out = step(&mut r, &mut e, &q);
        assert!(
            matches!(out.answer.response, Response::Refused { .. }),
            "{:?}",
            out.answer.response
        );
        assert_eq!(r.accounted_bytes(), before);
        assert_eq!(owned(&r, &q).pending_token, pending);
    }
    e.set_ceilings(Ceilings::default());
    let oracle = Oracle::freeze(&e);
    assert_eq!(drain(&mut r, &mut e, &mut q, &oracle).0.len(), 120);
}

#[test]
fn oversized_projection_omits_once_and_normal_rows_shorten_pages() {
    let actor = "a".repeat(128);
    let name = "p".repeat(128);
    let mut e = seeded([
        edge(&actor),
        post(&name, &actor, 5),
        post("own-a", "reader", 2),
        post("own-b", "reader", 1),
    ]);
    e.set_ceilings(Ceilings {
        output_bytes: 1024,
        ..Default::default()
    });
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 3);
    let out = step(&mut r, &mut e, &q);
    let Response::Page { items, .. } = &out.answer.response else {
        panic!("{:?}", out.answer.response)
    };
    assert!(matches!(
        &items[0],
        Item::Omitted {
            code: "E_FOLLOWING_ROW_TOO_LARGE",
            ..
        }
    ));
    assert_eq!(drain(&mut r, &mut e, &mut q, &oracle).0.len(), 3);
}

#[test]
fn continuous_backdating_checkpoints_strict_key_progress_and_never_false_end() {
    let mut e = seeded((0..30).map(|n| post(&format!("old-{n}"), "reader", n * 1000)));
    e.set_ceilings(Ceilings {
        examined: 24,
        ..Default::default()
    });
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 2);
    let mut stalled = 0;
    let mut after = None;
    let mut ids = Vec::new();
    for wave in 0..8 {
        let out = step(&mut r, &mut e, &q);
        match &out.answer.response {
            Response::Stalled { .. } => stalled += 1,
            Response::Preparing { .. } => {}
            Response::Page { items, next } => {
                assert!(next.is_some());
                after = oracle.page(&e, items, after.as_ref());
                ids.extend(items.iter().map(|i| i.id().to_owned()));
            }
            other => panic!("{other:?}"),
        }
        advance(&mut q, &out);
        let s = owned(&r, &q);
        let key = s
            .pending
            .as_ref()
            .and_then(|l| l.after.as_ref())
            .map(|p| p.at)
            .unwrap_or(30_000);
        e.set_ceilings(Ceilings::default());
        for n in 1..=20 {
            mutation(
                &mut e,
                "post",
                "reader",
                [
                    ("postId", id(format!("later-{wave}-{n}"))),
                    ("parentId", Value::Null),
                ],
                key - n,
            );
        }
        e.set_ceilings(Ceilings {
            examined: 24,
            ..Default::default()
        });
    }
    assert!(stalled > 0);
    // No further writers: all finite obstructions are crossed, then exhaustion.
    for _ in 0..2000 {
        let out = step(&mut r, &mut e, &q);
        match &out.answer.response {
            Response::Page { items, next } => {
                after = oracle.page(&e, items, after.as_ref());
                ids.extend(items.iter().map(|i| i.id().to_owned()));
                if next.is_none() {
                    assert_eq!(ids.len(), 30);
                    return;
                }
            }
            Response::Preparing { .. } | Response::Stalled { .. } => {}
            other => panic!("{other:?}"),
        }
        advance(&mut q, &out);
    }
    panic!("finite obstruction did not terminate");
}

#[test]
fn generated_corpora_match_owned_event_oracle_at_every_published_prefix() {
    for seed in 1..=16u64 {
        let mut random = seed;
        let mut roll = |n: u64| {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            random % n
        };
        let mut rows = Vec::new();
        for a in 0..12 {
            if roll(2) == 0 {
                rows.push(edge(&format!("a{a}")));
            }
        }
        for p in 0..80 {
            rows.push(post(
                &format!("p{p}"),
                &format!("a{}", roll(12)),
                roll(9) as i64,
            ));
        }
        let mut e = seeded(rows);
        let mut originals: BTreeMap<_, _> = e
            .store()
            .rows("posts")
            .unwrap()
            .into_iter()
            .map(|p| {
                (
                    p.field("id").unwrap().as_str().unwrap().to_owned(),
                    p.field("authorId").unwrap().as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let mut follows: BTreeSet<String> = e
            .store()
            .rows("follows")
            .unwrap()
            .into_iter()
            .map(|f| f.field("followedId").unwrap().as_str().unwrap().into())
            .collect();
        let mut reposts = BTreeSet::new();
        for n in 0..60 {
            let actor = format!("a{}", roll(12));
            let p = format!("p{}", roll(80));
            match roll(5) {
                0 => {
                    follows.insert(actor.clone());
                    mutation(&mut e, "follow", "reader", [("actor", id(actor))], 100 + n);
                }
                1 => {
                    if follows.remove(&actor) {
                        mutation(
                            &mut e,
                            "unfollow",
                            "reader",
                            [("actor", id(actor))],
                            100 + n,
                        );
                    }
                }
                2 => {
                    if originals.contains_key(&p) {
                        reposts.insert((actor.clone(), p.clone()));
                        mutation(
                            &mut e,
                            "repost",
                            &actor,
                            [("postId", id(p))],
                            (n % 9) as i64,
                        );
                    }
                }
                3 => {
                    if reposts.remove(&(actor.clone(), p.clone())) {
                        mutation(&mut e, "unrepost", &actor, [("postId", id(p))], 100 + n);
                    }
                }
                _ => {
                    if let Some(author) = originals.remove(&p) {
                        mutation(&mut e, "remove", &author, [("postId", id(p))], 100 + n);
                    }
                }
            }
        }
        let oracle = Oracle::freeze(&e);
        let expected = oracle
            .rows(&e)
            .into_iter()
            .map(|(_, id)| id)
            .collect::<Vec<_>>();
        e.set_ceilings(Ceilings {
            examined: 48,
            ..Default::default()
        });
        let mut r = Reader::new().unwrap();
        let mut q = request(&mut r, 1 + (seed % 5) as usize);
        assert_eq!(
            drain(&mut r, &mut e, &mut q, &oracle).0,
            expected,
            "seed={seed}"
        );
    }
}

#[test]
fn private_work_and_other_readers_edges_do_not_change_public_progress() {
    let rows = || {
        (0..30).flat_map(|n| {
            let a = format!("a{n:02}");
            [edge(&a), post(&format!("p{n:02}"), &a, n)]
        })
    };
    let mut a = seeded(rows());
    let mut b = seeded(rows());
    // Only queue-private columns change; admissions, live events and the
    // reader's roster stay equal. Direct owned writes model maintenance here.
    let table = b.schema.tables["feedWork"].clone();
    let work = b.store().rows("feedWork").unwrap();
    let tx = b.store.transaction().unwrap();
    for old in work {
        let mut fields = old.as_object().unwrap().clone();
        fields.insert("status".into(), Value::String("parked".into()));
        fields.insert("error".into(), Value::String("private-error".repeat(200)));
        fields.insert("cursor".into(), Value::String("private-cursor".repeat(200)));
        tx.put("feedWork", &table, &object(fields), Some(&old))
            .unwrap();
    }
    tx.commit().unwrap();
    for n in 0..30 {
        mutation(
            &mut b,
            "follow",
            "unrelated",
            [("actor", id(format!("z{n}")))],
            500 + n,
        );
    }
    a.set_ceilings(Ceilings {
        examined: 48,
        ..Default::default()
    });
    b.set_ceilings(a.ceilings());
    let mut ra = Reader::new().unwrap();
    let mut rb = Reader::new().unwrap();
    let mut qa = request(&mut ra, 3);
    let mut qb = request(&mut rb, 3);
    for _ in 0..1000 {
        let oa = step(&mut ra, &mut a, &qa);
        let ob = step(&mut rb, &mut b, &qb);
        let normalize = |o: &Outcome| {
            let mut j: serde_json::Value = serde_json::from_str(o.answer.bytes()).unwrap();
            if j.get("next").is_some_and(|n| n.is_string()) {
                j["next"] = serde_json::json!("opaque-unit");
            }
            j
        };
        assert_eq!(normalize(&oa), normalize(&ob));
        assert_eq!(oa.metered, ob.metered);
        if matches!(oa.answer.response, Response::Page { next: None, .. }) {
            return;
        }
        advance(&mut qa, &oa);
        advance(&mut qb, &ob);
    }
    panic!("paired settled worlds did not finish");
}

#[test]
fn empty_self_follow_and_all_removed_lanes_finish_and_births_do_not_resurrect_purges() {
    for rows in [vec![], vec![edge("a")], vec![post("own", "reader", 1)]] {
        let mut e = seeded(rows);
        let oracle = Oracle::freeze(&e);
        let mut r = Reader::new().unwrap();
        let mut q = request(&mut r, 2);
        assert_eq!(
            drain(&mut r, &mut e, &mut q, &oracle).0.len(),
            oracle.rows(&e).len()
        );
    }
    let mut e = seeded([edge("a"), post("p", "a", 1)]);
    mutation(&mut e, "remove", "a", [("postId", id("p"))], 2);
    assert!(!e.store().rows("feedWork").unwrap().is_empty());
    for purge in [false, true] {
        if purge {
            let table = e.schema.tables["feedPosts"].clone();
            let events = e.store().rows("feedPosts").unwrap();
            let tx = e.store.transaction().unwrap();
            for row in events {
                tx.delete("feedPosts", &table, &row).unwrap();
            }
            tx.commit().unwrap();
        }
        let oracle = Oracle::freeze(&e);
        let mut r = Reader::new().unwrap();
        let mut q = request(&mut r, 2);
        assert!(drain(&mut r, &mut e, &mut q, &oracle).0.is_empty());
    }
}

#[test]
fn same_transaction_refollow_with_reused_source_id_invalidates_the_opened_epoch() {
    let mut e = seeded([edge("a"), post("p", "a", 1), post("own", "reader", 0)]);
    let source = format!(
        "{SOURCE}\nmutation refollow(actor: principal, edgeId: id):\n  delete follows[viewer, actor]\n  return insert follows {{ id: edgeId, followerId: viewer, followedId: actor }}\n"
    );
    let (schema, programs) = compiled(&source);
    e.adopt_at(schema, programs, 100).unwrap();
    let mut r = Reader::new().unwrap();
    let q = request(&mut r, 1);
    let out = step(&mut r, &mut e, &q);
    assert!(matches!(&out.answer.response,Response::Page{items,..} if items[0].id()=="p"));
    let old = e.store().rows("feedEdges").unwrap()[0]
        .field("epoch")
        .unwrap()
        .clone();
    mutation(
        &mut e,
        "refollow",
        "reader",
        [("actor", id("a")), ("edgeId", id("edge-a"))],
        2,
    );
    assert_ne!(
        &old,
        e.store().rows("feedEdges").unwrap()[0]
            .field("epoch")
            .unwrap()
    );
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
}

#[test]
fn an_exhausted_session_has_no_empty_successor_and_self_follow_is_refused() {
    let mut e = seeded([post("own", "reader", 1)]);
    let result = e
        .mutate(
            "follow",
            None,
            Context::new("reader", BTreeMap::from([("actor".into(), id("reader"))])).at(2),
        )
        .unwrap();
    assert!(matches!(result.state, WriteState::Failed { .. }));
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 20);
    let out = step(&mut r, &mut e, &q);
    assert!(matches!(&out.answer.response,Response::Page{items,next:None} if items.len()==1));
    let storage = r.accounted_bytes();
    q.token = Some(String::new());
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
    assert_eq!(storage, r.accounted_bytes());
    q.token = None;
    assert_eq!(step(&mut r, &mut e, &q).answer.bytes(), out.answer.bytes());
}

#[test]
fn reclaimed_and_cross_viewer_openings_never_become_new_units() {
    let mut e = seeded([post("p", "reader", 1)]);
    let mut r = Reader::new().unwrap();
    for abandon in [false, true] {
        let q = request(&mut r, 2);
        for size in [0, 101] {
            let mut wrong = q.clone();
            wrong.page_size = size;
            assert!(matches!(
                step(&mut r, &mut e, &wrong).answer.response,
                Response::Restart
            ));
        }
        let out = step(&mut r, &mut e, &q);
        assert!(matches!(out.answer.response, Response::Page { .. }));
        let foreign = r
            .request(
                &mut e,
                q.clone(),
                Context::new("foreign", BTreeMap::new()).at(1_000_000),
            )
            .unwrap();
        assert!(matches!(foreign.answer.response, Response::Restart));
        if abandon {
            r.cancel("reader", &q.opening, Ceilings::default());
        }
        while r.accounted_bytes() > 0 {
            assert!(r.reclaim(1_400_000, Ceilings::default()).rows_written > 0);
        }
        assert!(matches!(
            step(&mut r, &mut e, &q).answer.response,
            Response::Restart
        ));
    }
    // Unused registrations have the same quota, expiry and cancellation custody.
    let q = request(&mut r, 2);
    let bytes = r.accounted_bytes();
    r.cancel("reader", &q.opening, Ceilings::default());
    assert_eq!(r.accounted_bytes(), bytes);
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
    r.reclaim(1_000_000, Ceilings::default());
    assert_eq!(r.accounted_bytes(), 0);
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
}

#[test]
fn rewind_after_an_observed_later_commit_restarts_even_above_the_birth_bound() {
    let mut e = seeded((0..8).map(|n| post(&format!("p{n}"), "reader", n)));
    let mut r = Reader::new().unwrap();
    let q = request(&mut r, 2);
    let out = step(&mut r, &mut e, &q);
    let initial = owned(&r, &q).head;
    for n in 0..3 {
        mutation(
            &mut e,
            "post",
            "unrelated",
            [("postId", id(format!("new{n}"))), ("parentId", Value::Null)],
            20 + n,
        );
    }
    assert_eq!(step(&mut r, &mut e, &q).answer.bytes(), out.answer.bytes());
    let observed = owned(&r, &q).head;
    assert!(observed > initial + 1);
    e.store()
        .conn()
        .execute(
            "DELETE FROM _commits WHERE seq > ?1",
            [(initial + 1) as i64],
        )
        .unwrap();
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
}

#[test]
fn discovery_checkpoints_post_bound_follow_churn_without_a_false_end() {
    let mut e = seeded((0..8).map(|n| edge(&format!("a{n}"))));
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 1);
    let mut previous = None;
    for wave in 0..8 {
        e.set_ceilings(Ceilings {
            examined: 20,
            ..Default::default()
        });
        let out = step(&mut r, &mut e, &q);
        assert!(matches!(
            out.answer.response,
            Response::Preparing { .. } | Response::Stalled { .. }
        ));
        let key = owned(&r, &q).edge_after.as_ref().unwrap()[0]
            .as_str()
            .unwrap()
            .to_owned();
        if key.starts_with('z') {
            assert!(matches!(out.answer.response, Response::Stalled { .. }));
        }
        assert!(previous.as_ref().is_none_or(|p| p < &key));
        previous = Some(key);
        advance(&mut q, &out);
        e.set_ceilings(Ceilings::default());
        for n in 0..30 {
            mutation(
                &mut e,
                "follow",
                "reader",
                [("actor", id(format!("z{wave:02}-{n:02}")))],
                100 + wave,
            );
        }
    }
    assert!(drain(&mut r, &mut e, &mut q, &oracle).0.is_empty());
}

#[test]
fn lifecycle_allocation_reservations_precede_key_clones_and_tree_changes() {
    let mut r = Reader::new().unwrap();
    let too_small = Ceilings {
        heap_bytes: LIFECYCLE_SCRATCH - 1,
        ..Default::default()
    };
    assert!(matches!(
        r.opening("reader", "feed", 2, 0, too_small),
        Err(RuntimeError::Structural {
            code: "E_FOLLOWING_REQUEST_TOO_SMALL",
            ..
        })
    ));
    assert!(r.openings.is_empty() && r.expiry.is_empty() && r.counts.is_empty());
    assert_eq!(r.accounted_bytes(), 0);
    // Multiple tree nodes and differently ordered cancellation keys exercise
    // lifecycle splits while keeping every refused reservation unchanged.
    let mut openings = Vec::new();
    for n in 0..96 {
        let viewer = format!("reader-{n:03}");
        let o = r
            .opening(&viewer, "feed", 2, n, Ceilings::default())
            .unwrap();
        assert_eq!(o.metered.heap_bytes, LIFECYCLE_SCRATCH);
        openings.push((viewer, o.request.opening));
    }
    let expiry = r.expiry.clone();
    let bytes = r.accounted_bytes();
    for (viewer, opening) in &openings {
        assert_eq!(r.cancel(viewer, opening, too_small), Metered::default());
        assert!(!r.openings[&(viewer.clone(), opening.clone())].abandoned);
    }
    assert_eq!(r.expiry, expiry);
    assert_eq!(r.accounted_bytes(), bytes);
    assert_eq!(r.reclaim(1_000_000, too_small), Metered::default());
    assert_eq!(r.expiry, expiry);
    assert_eq!(r.accounted_bytes(), bytes);
    for (viewer, opening) in &openings {
        let m = r.cancel(viewer, opening, Ceilings::default());
        assert_eq!(m.heap_bytes, LIFECYCLE_SCRATCH);
        assert!(budget::fits(Ceilings::default(), m));
    }
    let m = r.reclaim(
        1_000_000,
        Ceilings {
            heap_bytes: LIFECYCLE_SCRATCH,
            ..Default::default()
        },
    );
    assert_eq!(m.rows_written, 1);
    assert_eq!(m.heap_bytes, LIFECYCLE_SCRATCH);
    assert_eq!(r.accounted_bytes(), bytes - SESSION_BASE);
    while r.accounted_bytes() > 0 {
        let m = r.reclaim(1_000_000, Ceilings::default());
        assert!(budget::fits(Ceilings::default(), m));
        assert!(m.rows_written > 0);
    }
    assert!(r.openings.is_empty() && r.expiry.is_empty() && r.counts.is_empty());
}

#[test]
fn shaped_pages_preserve_the_independent_owned_event_prefix_oracle() {
    let mut e = seeded(
        (0..100)
            .map(|n| {
                post(
                    &format!("p{n:03}"),
                    if n % 3 == 0 { "a" } else { "noise" },
                    n / 2,
                )
            })
            .chain([edge("a")]),
    );
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = r
        .opening_projected(
            &e,
            "cards",
            Context::new("reader", BTreeMap::new()).at(1_000_000),
        )
        .unwrap()
        .request;
    let mut after = None;
    let mut ids = Vec::new();
    for _ in 0..100 {
        let o = r
            .request_projected(
                &mut e,
                q.clone(),
                Context::new("reader", BTreeMap::new()).at(1_000_000),
                "cards",
            )
            .unwrap();
        assert!(budget::fits(e.ceilings(), o.metered));
        if let Response::Page { items, next } = &o.answer.response {
            after = oracle.page(&e, items, after.as_ref());
            ids.extend(items.iter().map(|i| i.id().to_owned()));
            if next.is_none() {
                assert_eq!(ids.len(), 34);
                return;
            }
        }
        q.token = o.answer.response.next().map(str::to_owned);
    }
    panic!("shaped reader did not terminate");
}


#[test]
fn smaller_allowances_refuse_retained_page_without_advancing_and_same_token_recovers() {
    let mut e = seeded((0..8).map(|n| post(&format!("p{n}{}", "x".repeat(120)), "reader", n)));
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 4);
    e.set_ceilings(Ceilings { examined: 50, ..Default::default() });
    let first = step(&mut r, &mut e, &q);
    assert!(matches!(first.answer.response, Response::Preparing { .. }));
    assert_eq!(owned(&r, &q).staged.len(), 3);
    advance(&mut q, &first);
    let before = r.accounted_bytes();
    let pending = owned(&r, &q).pending_token.clone();
    for c in [
        Ceilings { output_bytes: 1024, ..Default::default() },
        Ceilings { heap_bytes: SCRATCH + (8 << 20), ..Default::default() },
        Ceilings { examined: 17, ..Default::default() },
        Ceilings { rule_probes: 7, ..Default::default() },
        Ceilings { steps: 575, ..Default::default() },
        Ceilings { rows_written: 4, ..Default::default() },
    ] {
        e.set_ceilings(c);
        let out = step(&mut r, &mut e, &q);
        assert!(matches!(out.answer.response, Response::Refused { code: "E_FOLLOWING_REQUEST_TOO_SMALL" }), "{c:?}: {:?}", out.answer.response);
        assert_eq!(out.metered.rows_written, 0);
        assert_eq!(r.accounted_bytes(), before);
        assert_eq!(owned(&r, &q).pending_token, pending);
        assert_eq!(owned(&r, &q).staged.len(), 3);
    }
    e.set_ceilings(Ceilings::default());
    let recovered = step(&mut r, &mut e, &q);
    assert!(matches!(&recovered.answer.response, Response::Page { items, .. } if items.len() == 4));
    e.set_ceilings(Ceilings { output_bytes: 1024, ..Default::default() });
    assert!(matches!(step(&mut r, &mut e, &q).answer.response, Response::Refused { .. }));
    e.set_ceilings(Ceilings::default());
    assert_eq!(step(&mut r, &mut e, &q).answer.bytes(), recovered.answer.bytes());
    assert_eq!(drain(&mut r, &mut e, &mut q, &oracle).0.len(), 8);
}


#[test]
fn discovery_self_skip_is_preparing_and_finished_page_wins_over_post_bound_churn() {
    let mut e = seeded([]);
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 1);
    e.set_ceilings(Ceilings { examined: 10, ..Default::default() });
    let first = step(&mut r, &mut e, &q);
    assert!(matches!(first.answer.response, Response::Preparing { .. }));
    advance(&mut q, &first);
    e.set_ceilings(Ceilings::default());
    mutation(&mut e, "follow", "reader", [("actor", id("z-later"))], 101);
    // Current mutations refuse self-follow. Model an inherited self edge with
    // the later epoch to exercise discovery's defensive skip ordering.
    let table = e.schema.tables["feedEdges"].clone();
    let mut fields = e.store().rows("feedEdges").unwrap()[0].as_object().unwrap().clone();
    fields.insert("id".into(), id("legacy-self"));
    fields.insert("actorId".into(), id("reader"));
    let tx = e.store.transaction().unwrap();
    tx.put("feedEdges", &table, &object(fields), None).unwrap();
    tx.commit().unwrap();
    e.set_ceilings(Ceilings { examined: 7, ..Default::default() });
    let skip = step(&mut r, &mut e, &q);
    assert!(matches!(skip.answer.response, Response::Preparing { .. }));
    assert_eq!(owned(&r, &q).edge_after.as_ref().unwrap()[0], id("reader"));
    advance(&mut q, &skip);
    e.set_ceilings(Ceilings::default());
    let end = step(&mut r, &mut e, &q);
    assert!(matches!(&end.answer.response, Response::Page { items, next: None } if items.is_empty()));
    assert!(drain(&mut r, &mut e, &mut q, &oracle).0.is_empty());
}

#[test]
fn tombstone_and_physical_purge_interleave_with_retained_heads_and_staged_pages() {
    let mut witnessed = [0; 4];
    for purge in [false, true] {
        for limit in 20..65 {
            let mut e = seeded([edge("a"), post("new", "a", 3), post("middle", "a", 2), post("old", "a", 1)]);
            let oracle = Oracle::freeze(&e);
            let mut r = Reader::new().unwrap();
            let mut q = request(&mut r, 3);
            e.set_ceilings(Ceilings { examined: limit, ..Default::default() });
            let first = step(&mut r, &mut e, &q);
            if !matches!(first.answer.response, Response::Preparing { .. }) { continue; }
            let s = owned(&r, &q);
            let staged = s.staged.iter().any(|x| x.head.event.id == "new");
            if !staged && s.frontier.heads == 0 { continue; }
            advance(&mut q, &first);
            e.set_ceilings(Ceilings::default());
            if purge {
                let table = e.schema.tables["feedPosts"].clone();
                let row = e.store().rows("feedPosts").unwrap().into_iter().find(|r| r.field("id").unwrap() == &id("new")).unwrap();
                let tx = e.store.transaction().unwrap();
                tx.delete("feedPosts", &table, &row).unwrap();
                tx.commit().unwrap();
            } else { mutation(&mut e, "remove", "a", [("postId", id("new"))], 100); }
            witnessed[usize::from(purge) * 2 + usize::from(staged)] += 1;
            if staged {
                assert!(matches!(step(&mut r, &mut e, &q).answer.response, Response::Restart));
            } else {
                assert_eq!(drain(&mut r, &mut e, &mut q, &oracle).0, vec!["middle", "old"]);
            }
        }
    }
    assert!(witnessed.iter().all(|n| *n > 0), "{witnessed:?}");
}
