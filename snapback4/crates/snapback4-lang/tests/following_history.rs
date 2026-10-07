#[test]
fn generated_following_projection() {
    let source = format!(
        "{}\nquery cards(c: cursor ?):\n  return feed[viewer] after c last 20 {{ *, card: posts[.postId] }}\n",
        include_str!("fixtures/timeline-v2.q")
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    use snapback4_core::engine::following_history::{Item, Reader, Response, projection};
    use snapback4_core::{Context, Engine, Value};
    let plan = projection::plan(
        &bound.schema,
        &bound
            .programs
            .iter()
            .find(|p| p.program.name == "cards")
            .unwrap()
            .program,
    )
    .unwrap();
    assert_eq!(plan.binding.declaration, "feed");
    let mut e = Engine::memory(
        bound.schema.clone(),
        bound.programs.iter().map(|p| p.program.clone()),
    )
    .unwrap();
    e.mutate(
        "post",
        None,
        Context::new(
            "reader",
            [
                ("postId".into(), Value::Id("p".into())),
                ("parentId".into(), Value::Null),
            ]
            .into(),
        )
        .at(10),
    )
    .unwrap();
    let mut r = Reader::new().unwrap();
    let q = r
        .opening_projected(
            &e,
            "cards",
            Context::new("reader", Default::default()).at(100),
        )
        .unwrap()
        .request;
    let context = || Context::new("reader", Default::default()).at(100);
    let out = r
        .request_projected(&mut e, q.clone(), context(), "cards")
        .unwrap();
    let Response::Page { items, .. } = &out.answer.response else {
        panic!("{}", out.answer.bytes())
    };
    assert!(matches!(&items[0],Item::Shaped{value,..} if value["card"]["id"]=="p"));
    assert_eq!(
        r.request_projected(&mut e, q, context(), "cards")
            .unwrap()
            .answer
            .bytes(),
        out.answer.bytes()
    );
}

fn fixture() -> Engine {
    let source = format!("{}\nquery cards(c: cursor ?):\n  return feed[viewer] after c last 20 {{ *, card: posts[.postId] }}\nmutation edit(postId: posts, body: text <=200000):\n  update posts[postId] {{ body }}\nmutation transfer(postId: posts, owner: principal):\n  update posts[postId] {{ owner }}\n", include_str!("fixtures/timeline-v2.q"))
        .replace("  authorId: principal\n", "  authorId: principal\n  owner: principal\n  body: text <=200000 default ''\n  secret: text <=100 default '' written by .owner\n")
        .replace("authorId: viewer, parentId", "authorId: viewer, owner: viewer, parentId");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
use snapback4_core::engine::following_history::{Item, Mounted, Reader, Refresh, Response};
use snapback4_core::{Ceilings, Context, Engine, Value};
fn context() -> Context {
    Context::new("reader", Default::default()).at(100)
}
fn mutate(e: &mut Engine, op: &str, args: impl IntoIterator<Item = (&'static str, Value)>) {
    let out = e
        .mutate(
            op,
            None,
            Context::new(
                "reader",
                args.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            )
            .at(10),
        )
        .unwrap();
    assert!(
        matches!(out.state, snapback4_core::WriteState::Sent { .. }),
        "{out:?}"
    );
}
fn post(e: &mut Engine, id: &str) {
    mutate(
        e,
        "post",
        [("postId", Value::Id(id.into())), ("parentId", Value::Null)],
    )
}

#[test]
fn replay_pins_card_bytes_while_rechecking_only_current_authority() {
    let mut e = fixture();
    post(&mut e, "one");
    let mut r = Reader::new().unwrap();
    let q = r.opening_projected(&e, "cards", context()).unwrap().request;
    let first = r
        .request_projected(&mut e, q.clone(), context(), "cards")
        .unwrap();
    let Response::Page { items, .. } = &first.answer.response else {
        panic!("{}", first.answer.bytes())
    };
    let Item::Shaped {
        value, authority, ..
    } = &items[0]
    else {
        panic!("{items:?}")
    };
    assert_eq!(value["card"]["secret"], "");
    mutate(
        &mut e,
        "edit",
        [
            ("postId", Value::Id("one".into())),
            ("body", Value::String("x".repeat(190000))),
        ],
    );
    let replay = r
        .request_projected(&mut e, q.clone(), context(), "cards")
        .unwrap();
    assert_eq!(
        replay.answer.bytes(),
        first.answer.bytes(),
        "editing a body cannot change a pinned page or grow its authority probe"
    );
    mutate(
        &mut e,
        "transfer",
        [
            ("postId", Value::Id("one".into())),
            ("owner", Value::Id("other".into())),
        ],
    );
    assert!(matches!(
        r.request_projected(&mut e, q.clone(), context(), "cards")
            .unwrap()
            .answer
            .response,
        Response::Restart
    ));
    let mounted = [Mounted {
        live: false,
        id: "one".into(),
        authority: authority.clone(),
    }];
    let refreshed = r
        .refresh(&mut e, &q.opening, "cards", context(), &mounted)
        .unwrap();
    assert!(matches!(refreshed,Refresh::Page{visible,..} if visible.is_empty()));
}

#[test]
fn oversized_card_is_a_consumed_named_omission_and_all_meters_stay_bounded() {
    let mut e = fixture();
    post(&mut e, "small");
    post(&mut e, "wide");
    mutate(
        &mut e,
        "edit",
        [
            ("postId", Value::Id("wide".into())),
            ("body", Value::String("x".repeat(190000))),
        ],
    );
    let mut r = Reader::new().unwrap();
    let q = r.opening_projected(&e, "cards", context()).unwrap().request;
    let out = r.request_projected(&mut e, q, context(), "cards").unwrap();
    let Response::Page { items, next } = &out.answer.response else {
        panic!("{}", out.answer.bytes())
    };
    assert_eq!(items.len(), 2);
    assert!(next.is_none());
    assert!(
        matches!(&items[0],Item::Omitted{id,code,..} if id=="wide"&&*code=="E_FOLLOWING_ROW_TOO_LARGE")
    );
    assert!(matches!(&items[1],Item::Shaped{id,..} if id=="small"));
    let actual = serde_json::to_value(out.metered).unwrap();
    let cap = serde_json::to_value(Ceilings::default()).unwrap();
    for (name, value) in actual.as_object().unwrap() {
        assert!(
            value.as_u64().unwrap() <= cap[name].as_u64().unwrap(),
            "{name}: {value}"
        )
    }
}

#[test]
fn opening_binds_operation_and_viewer() {
    let mut e = fixture();
    post(&mut e, "one");
    let mut r = Reader::new().unwrap();
    let q = r.opening_projected(&e, "cards", context()).unwrap().request;
    assert!(matches!(
        r.request_projected(&mut e, q.clone(), context(), "home")
            .unwrap()
            .answer
            .response,
        Response::Restart
    ));
    let wrong = Context::new("other", Default::default()).at(100);
    assert!(matches!(
        r.request_projected(&mut e, q.clone(), wrong, "cards")
            .unwrap()
            .answer
            .response,
        Response::Restart
    ));
    assert!(matches!(
        r.request_projected(&mut e, q, context(), "cards")
            .unwrap()
            .answer
            .response,
        Response::Page { .. }
    ));
}

#[test]
fn live_prepend_uses_post_bound_births_without_restarting_history() {
    let mut e = fixture();
    post(&mut e, "old");
    let mut r = Reader::new().unwrap();
    let q = r.opening_projected(&e, "cards", context()).unwrap().request;
    let _ = r
        .request_projected(&mut e, q.clone(), context(), "cards")
        .unwrap();
    post(&mut e, "new");
    let refreshed = r
        .refresh(&mut e, &q.opening, "cards", context(), &[])
        .unwrap();
    let Refresh::Page { live, .. } = refreshed else {
        panic!("refresh failed")
    };
    assert_eq!(live.iter().map(|i| i.id()).collect::<Vec<_>>(), ["new"]);
}

#[test]
fn hidden_private_fields_do_not_create_false_replay_revocations() {
    let mut e = fixture();
    post(&mut e, "old");
    mutate(
        &mut e,
        "transfer",
        [
            ("postId", Value::Id("old".into())),
            ("owner", Value::Id("other".into())),
        ],
    );
    let mut r = Reader::new().unwrap();
    let q = r.opening_projected(&e, "cards", context()).unwrap().request;
    let first = r
        .request_projected(&mut e, q.clone(), context(), "cards")
        .unwrap();
    assert!(
        matches!(first.answer.response, Response::Page { .. }),
        "{}",
        first.answer.bytes()
    );
    assert_eq!(
        r.request_projected(&mut e, q.clone(), context(), "cards")
            .unwrap()
            .answer
            .bytes(),
        first.answer.bytes()
    );
    let (response, m) = r
        .refresh_metered(&mut e, &q.opening, "cards", context(), &[])
        .unwrap();
    assert!(matches!(response, Refresh::Page { .. }));
    let actual = serde_json::to_value(m).unwrap();
    let cap = serde_json::to_value(Ceilings::default()).unwrap();
    for (name, value) in actual.as_object().unwrap() {
        assert!(
            value.as_u64().unwrap() <= cap[name].as_u64().unwrap(),
            "{name}: {value}"
        )
    }
}

#[test]
fn maps_of_small_fields_shorten_pages_under_heap_without_omitting_fitting_cards() {
    let fields = (0..256)
        .map(|n| format!("f{n}: 0"))
        .collect::<Vec<_>>()
        .join(", ");
    let source = format!(
        "{}\nquery cards(c: cursor ?):\n  return feed[viewer] after c last 20 {{ *, small: {{ {fields} }} }}\n",
        include_str!("fixtures/timeline-v2.q")
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e =
        Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for n in 0..30 {
        post(&mut e, &format!("p{n:03}"));
    }
    let mut r = Reader::new().unwrap();
    let mut q = r.opening_projected(&e, "cards", context()).unwrap().request;
    let mut ids = Vec::new();
    let mut pages = 0;
    for _ in 0..40 {
        let out = r
            .request_projected(&mut e, q.clone(), context(), "cards")
            .unwrap();
        assert!(out.metered.heap_bytes <= Ceilings::default().heap_bytes);
        match &out.answer.response {
            Response::Page { items, next } => {
                pages += 1;
                for item in items {
                    let Item::Shaped { id, value, .. } = item else {
                        panic!("{item:?}")
                    };
                    assert_eq!(value["small"].as_object().unwrap().len(), 256);
                    ids.push(id.clone());
                }
                if next.is_none() {
                    break;
                }
            }
            Response::Preparing { .. } => {}
            other => panic!("{other:?}"),
        }
        q.token = out.answer.response.next().map(str::to_owned);
    }
    assert_eq!(
        ids,
        (0..30)
            .rev()
            .map(|n| format!("p{n:03}"))
            .collect::<Vec<_>>()
    );
    assert!(
        pages > 2,
        "object custody, not just short JSON length, limits a page"
    );
}

#[test]
fn shaped_unit_arguments_are_bound_without_consuming_the_original_token() {
    let source = format!(
        "{}\nquery cards(c: cursor ?, tag: text <=10):\n  return feed[viewer] after c last 20 {{ *, tag: tag }}\n",
        include_str!("fixtures/timeline-v2.q")
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e =
        Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    post(&mut e, "one");
    let input = |tag: &str| {
        Context::new("reader", [("tag".into(), Value::String(tag.into()))].into()).at(100)
    };
    let mut r = Reader::new().unwrap();
    let q = r
        .opening_projected(&e, "cards", input("first"))
        .unwrap()
        .request;
    let first = r
        .request_projected(&mut e, q.clone(), input("first"), "cards")
        .unwrap();
    assert!(matches!(first.answer.response, Response::Page { .. }));
    assert!(matches!(
        r.request_projected(&mut e, q.clone(), input("other"), "cards")
            .unwrap()
            .answer
            .response,
        Response::Restart
    ));
    assert_eq!(
        r.request_projected(&mut e, q, input("first"), "cards")
            .unwrap()
            .answer
            .bytes(),
        first.answer.bytes()
    );
}

#[test]
fn refresh_slices_wide_authority_at_the_allowance_boundary_and_reports_refused_work() {
    let fields = (0..120)
        .map(|n| format!("  extra{n:03}: int default 0"))
        .collect::<Vec<_>>()
        .join("\n");
    let source = include_str!("fixtures/following-view.q")
        .replace("table posts:", &format!("table posts:\n{fields}"));
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for n in 0..40 {
        post(&mut e, &format!("wide-{n:03}"));
    }
    let mut r = Reader::new().unwrap();
    let mut q = r.opening_projected(&e, "cards", context()).unwrap().request;
    let mut mounted = Vec::new();
    loop {
        let out = r
            .request_projected(&mut e, q.clone(), context(), "cards")
            .unwrap();
        if let Response::Page { items, next } = &out.answer.response {
            for item in items {
                let Item::Shaped { id, authority, .. } = item else {
                    panic!("{item:?}")
                };
                mounted.push(Mounted {
                    id: id.clone(),
                    live: false,
                    authority: authority.clone(),
                });
            }
            if next.is_none() {
                break;
            }
        }
        q.token = out.answer.response.next().map(str::to_owned);
    }
    assert_eq!(mounted.len(), 40);
    let mut start = 0;
    let mut visible = Vec::new();
    let mut slices = 0;
    while start < mounted.len() {
        let (reply, used) = r
            .refresh_metered(&mut e, &q.opening, "cards", context(), &mounted[start..])
            .unwrap();
        assert!(used.heap_bytes <= Ceilings::default().heap_bytes);
        match reply {
            Refresh::Preparing {
                visible: ids,
                checked: Some(id),
                ..
            } => {
                start += mounted[start..].iter().position(|m| m.id == id).unwrap() + 1;
                visible.extend(ids);
            }
            Refresh::Page { visible: ids, .. } => {
                start = mounted.len();
                visible.extend(ids);
            }
            other => panic!("{other:?}"),
        }
        slices += 1;
    }
    assert!(slices > 1);
    assert_eq!(
        visible,
        mounted.iter().map(|m| m.id.clone()).collect::<Vec<_>>()
    );
    // Exactly enough for scratch + one authority reservation + publication.
    let boundary = 14 << 20;
    e.set_ceilings(Ceilings {
        heap_bytes: boundary,
        ..Default::default()
    });
    let (reply, used) = r
        .refresh_metered(&mut e, &q.opening, "cards", context(), &mounted)
        .unwrap();
    assert!(matches!(reply,Refresh::Preparing{checked:Some(id),..} if id==mounted[0].id));
    assert!(used.heap_bytes <= boundary);
    e.set_ceilings(Ceilings {
        heap_bytes: boundary - 1,
        ..Default::default()
    });
    assert!(matches!(
        r.refresh(&mut e, &q.opening, "cards", context(), &mounted)
            .unwrap(),
        Refresh::Refused {
            code: "E_FOLLOWING_REQUEST_TOO_SMALL"
        }
    ));
    e.set_ceilings(Ceilings {
        output_bytes: 1024,
        ..Default::default()
    });
    let (reply, used) = r
        .refresh_metered(&mut e, &q.opening, "cards", context(), &mounted)
        .unwrap();
    assert!(matches!(
        reply,
        Refresh::Preparing {
            checked: Some(_),
            ..
        }
    ));
    assert!(used.output_bytes <= 1024);
    // The final output charge fails AFTER ordinary inbox work. No failed charge
    // is retained, but completed work must not disappear from operator meters.
    e.set_ceilings(Ceilings {
        output_bytes: 512,
        ..Default::default()
    });
    let (reply, used) = r
        .refresh_metered(&mut e, &q.opening, "cards", context(), &[])
        .unwrap();
    assert!(matches!(
        reply,
        Refresh::Refused {
            code: "E_FOLLOWING_REQUEST_TOO_SMALL"
        }
    ));
    assert!(used.examined > 0 && used.heap_bytes > 0);
    assert_eq!(used.output_bytes, 512);
    e.set_ceilings(Ceilings::default());
    assert!(matches!(
        r.refresh(&mut e, &q.opening, "cards", context(), &mounted[..1])
            .unwrap(),
        Refresh::Page { .. }
    ));
}

#[test]
fn retained_live_preview_requires_a_copy_in_the_current_follow_epoch() {
    let b = snapback4_lang::compile(&[(
        "schema.q".into(),
        include_str!("fixtures/following-view.q").into(),
    )]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    mutate(&mut e, "follow", [("actor", Value::Id("alice".into()))]);
    let mut r = Reader::new().unwrap();
    let q = r.opening_projected(&e, "cards", context()).unwrap().request;
    r.request_projected(&mut e, q.clone(), context(), "cards")
        .unwrap();
    let publish = |e: &mut Engine, id: &str, at: i64| {
        e.mutate(
            "post",
            None,
            Context::new(
                "alice",
                [
                    ("postId".into(), Value::Id(id.into())),
                    ("parentId".into(), Value::Null),
                ]
                .into(),
            )
            .at(at),
        )
        .unwrap();
        while e.run_timeline_chunk(5000).unwrap().is_some() {}
    };
    publish(&mut e, "old-live", 10);
    let Refresh::Page { live, .. } = r
        .refresh(&mut e, &q.opening, "cards", context(), &[])
        .unwrap()
    else {
        panic!("live preview")
    };
    let Item::Shaped { id, authority, .. } = &live[0] else {
        panic!("card")
    };
    let mounted = [Mounted {
        id: id.clone(),
        live: true,
        authority: authority.clone(),
    }];
    mutate(&mut e, "unfollow", [("actor", Value::Id("alice".into()))]);
    // The previous live item lies outside the refollow's 1,000-event window.
    for n in 0..1001 {
        publish(&mut e, &format!("new-{n:04}"), 20);
    }
    mutate(&mut e, "follow", [("actor", Value::Id("alice".into()))]);
    assert!(
        matches!(r.refresh(&mut e,&q.opening,"cards",context(),&mounted).unwrap(),Refresh::Page {visible,..} if visible.is_empty())
    );
}
