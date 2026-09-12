use serde_json::json;
use snapback3_core::{Value, ir::Expr, search_key::*, unicode::*};

fn component() -> IndexComponent {
    IndexComponent::WordPrefixes {
        fields: vec!["name".into(), "handle".into()],
        contract: SearchContract::Unicode17,
    }
}
fn atom(source: &str) -> IndexAtom {
    IndexAtom::WordPrefix(WordPrefix {
        contract: SearchContract::Unicode17,
        source: source.into(),
    })
}
fn key(source: &str, q: usize) -> LogicalIndexAtom {
    prepare_index_atom(
        &component(),
        &atom(source),
        Some(q),
        &mut SearchNormalizer::default(),
    )
    .unwrap()
}

#[test]
fn exact_source_descriptor_contract_without_authoring_activation() {
    assert_eq!(
        serde_json::to_value(component()).unwrap(),
        json!({"WordPrefixes":{"fields":["name","handle"],"contract":SEARCH_CONTRACT}})
    );
    let expr: IndexKeyExpr = IndexKeyExpr::WordPrefix {
        source: Expr::Variable("term".into()),
        contract: SearchContract::Unicode17,
        source_max: 2000,
    };
    assert_eq!(
        serde_json::to_value(expr).unwrap(),
        json!({"WordPrefix":{"source":{"Variable":"term"},"contract":SEARCH_CONTRACT,"source_max":2000}})
    );
    assert_eq!(
        serde_json::to_value(atom("E\u{301}")).unwrap(),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":"E\u{301}"}})
    );
    let wire = serde_json::to_string(&atom("E\u{301}")).unwrap();
    let (decoded, logical) = decode_index_atom(
        &wire,
        &component(),
        Some(2),
        &mut SearchNormalizer::default(),
    )
    .unwrap();
    assert_eq!(serde_json::to_string(&decoded).unwrap(), wire);
    assert_eq!(logical, key("É", 1));
    // Existing Schema::Index and IR are not changed to admit this preparatory surface.
    assert!(serde_json::from_value::<snapback3_core::Index>(json!({
        "name":"bySearch", "components":[{"WordPrefixes":{"fields":["name"],"contract":SEARCH_CONTRACT}}], "unique":false
    })).is_err());
}

#[test]
fn independent_query_bound_and_exact_logical_tuple_prefix() {
    let scope = LogicalIndexAtom::Scalar(Value::Id("conversation".into()));
    assert!(index_keys_equal(
        &[scope.clone(), key("É", 1)],
        &[scope.clone(), key("E\u{301}", 2)]
    ));
    assert!(index_key_starts_with(
        &[
            scope.clone(),
            key("E\u{301}", 2),
            LogicalIndexAtom::Scalar(Value::Int(1))
        ],
        &[scope.clone(), key("É", 1)]
    ));
    assert!(!index_key_starts_with(
        &[scope.clone(), key("cat", 3)],
        &[scope, key("ca", 2)]
    ));
    assert!(!index_keys_equal(&[key("Straße", 6)], &[key("STRASSE", 7)]));
    assert!(!index_keys_equal(
        &[key("a", 1)],
        &[LogicalIndexAtom::Scalar(Value::String("a".into()))]
    ));
    assert!(
        prepare_index_atom(
            &component(),
            &atom("E\u{301}"),
            Some(1),
            &mut SearchNormalizer::default()
        )
        .is_err()
    );
    assert!(index_keys_equal(
        &[key(&"É".repeat(1000), 1000)],
        &[key(&"E\u{301}".repeat(1000), 2000)]
    ));
    assert!(index_keys_equal(
        &[key(&"𐐀".repeat(2000), 2000)],
        &[key(&"𐐨".repeat(2000), 2000)]
    ));
    assert!(index_keys_equal(
        &[key(&"\u{1d160}".repeat(2000), 2000)],
        &[key(&"\u{1d158}\u{1d165}\u{1d16e}".repeat(2000), 6000)]
    ));
    let LogicalIndexAtom::WordPrefix(empty) = key(" —", 2) else {
        panic!()
    };
    assert!(empty.is_empty());
    assert!(!empty.matches_normalized_word("anything"));
    let LogicalIndexAtom::WordPrefix(ca) = key("CA", 2) else {
        panic!()
    };
    assert!(ca.matches_normalized_word("café"));
    assert!(!ca.matches_normalized_word("éca"));
    assert!(compare_scalar_atoms(&key("a", 1), &key("a", 1)).is_err());
    let scalar = |s: &str| LogicalIndexAtom::Scalar(Value::String(s.into()));
    assert!(
        compare_scalar_atoms(&scalar("\u{ffff}"), &scalar("𐐀"))
            .unwrap()
            .is_lt()
    );
    assert!(
        compare_scalar_atoms(
            &scalar("x"),
            &LogicalIndexAtom::Scalar(Value::Id("x".into()))
        )
        .unwrap()
        .is_lt()
    );
}

#[test]
fn strict_slot_contract_scalar_bound_and_occurrence_validation() {
    let mut n = SearchNormalizer::default();
    for bad in [
        json!({}),
        json!({"WordPrefix":{"source":"foo"}}),
        json!({"WordPrefix":{"contract":"unknown","source":"foo"}}),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":"foo","source_max":999}}),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":"foo"},"extra":1}),
        json!({"Scalar":{"String":"foo"}}),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":"foo foo"}}),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":null}}),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":"\0"}}),
        json!({"WordPrefix":{"contract":SEARCH_CONTRACT,"source":"\u{b}"}}),
    ] {
        assert_eq!(
            decode_index_atom(&bad.to_string(), &component(), Some(100), &mut n)
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
    }
    let bad_scalar =
        format!(r#"{{"WordPrefix":{{"contract":"{SEARCH_CONTRACT}","source":"\ud800"}}}}"#);
    assert!(decode_index_atom(&bad_scalar, &component(), Some(100), &mut n).is_err());
    assert!(prepare_index_atom(&component(), &atom("foo"), None, &mut n).is_err());
    assert!(
        prepare_index_atom(
            &IndexComponent::Column("name".into()),
            &atom("foo"),
            Some(100),
            &mut n
        )
        .is_err()
    );
    for value in [Value::Int(i64::MAX), Value::Array(vec![])] {
        assert!(
            prepare_index_atom(
                &IndexComponent::Column("name".into()),
                &IndexAtom::Scalar(value),
                None,
                &mut n
            )
            .is_err()
        );
    }
    assert_eq!(
        prepare_index_atom(
            &IndexComponent::Column("name".into()),
            &IndexAtom::Scalar(Value::Null),
            None,
            &mut n
        )
        .unwrap(),
        LogicalIndexAtom::Scalar(Value::Null)
    );
}

#[test]
fn canonical_json_and_actual_source_descriptor_byte_bound() {
    let mut n = SearchNormalizer::default();
    for json in [
        format!(r#"{{"WordPrefix":{{"contract":"{SEARCH_CONTRACT}","source":"a","source":"a"}}}}"#),
        format!(
            r#"{{"WordPrefix":{{"contract":"{SEARCH_CONTRACT}","contract":"{SEARCH_CONTRACT}","source":"a"}}}}"#
        ),
        format!(r#"{{"WordPrefix":{{"source":"a","contract":"{SEARCH_CONTRACT}"}}}}"#),
        format!(" {}", serde_json::to_string(&atom("a")).unwrap()),
    ] {
        assert!(decode_index_atom(&json, &component(), Some(100), &mut n).is_err());
    }
    for ch in ["𐐀", "\"", "\\", "\t", "\n", "\r", "\u{2028}"] {
        let json = serde_json::to_string(&atom(&ch.repeat(2000))).unwrap();
        assert!(json.len() <= word_prefix_wire_max(2000).unwrap());
        if ch == "𐐀" {
            assert_eq!(json.len(), word_prefix_wire_max(2000).unwrap());
        }
        decode_index_atom(&json, &component(), Some(2000), &mut n).unwrap();
    }
}
