//! Physical-layout measurement; only scripts/test-postgres.sh supplies a database.
use snapback4_core::{Value, key, engine::postgres::PostgresEngine};
use snapback4_postgres_evaluation::*;

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn measure_incompressible_encoded_index_key_limit() {
    let (schema, programs) = compiled();
    let name = namespace("key_limit");
    let _engine = PostgresEngine::create(connect(), &name, schema, programs).unwrap();
    let mut client = connect();
    client.batch_execute(&format!("SET search_path TO {name}; BEGIN")).unwrap();
    let mut fits = |size: usize| {
        // Nonzero pseudorandom bytes avoid compression and escaping; the
        // length includes tags, terminators and the appended row identity.
        let mut state = 0x17382abcdefu64;
        let bytes = (0..size - 7).map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % 255 + 1) as u8
        }).collect();
        let encoded = key::encode(&[Value::Bytes(bytes), id("x")]);
        assert_eq!(encoded.len(), size);
        client.batch_execute("SAVEPOINT measurement").unwrap();
        let result = client.execute("INSERT INTO i VALUES ('items','byRoomTitle',$1,'x')", &[&encoded]);
        client.batch_execute("ROLLBACK TO SAVEPOINT measurement; RELEASE SAVEPOINT measurement").unwrap();
        match result {
            Ok(_) => true,
            Err(error) => {
                assert_eq!(error.code().map(|c| c.code()), Some("54000"), "{error}");
                false
            }
        }
    };
    let (mut low, mut high) = (512, 8192);
    assert!(fits(low));
    assert!(!fits(high));
    while low + 1 < high {
        let mid = (low + high) / 2;
        if fits(mid) { low = mid; } else { high = mid; }
    }
    assert!(fits(low));
    assert!(!fits(high));
    client.batch_execute("ROLLBACK").unwrap();
    // SET and BEGIN shared the initial simple-query message; rollback also
    // restores the prior search path. Re-select our private namespace.
    client.batch_execute(&format!("SET search_path TO {name}")).unwrap();
    let version: String = client.query_one("SHOW server_version", &[]).unwrap().get(0);
    let block: String = client.query_one("SHOW block_size", &[]).unwrap().get(0);
    println!("KEY_LIMIT: Postgres {version}, block_size={block}, i PK (t,ix,k), t=items ix=byRoomTitle: largest encoded key {low} bytes; {high} refused (54000)");
    let label = "t".repeat(snapback4_core::rows::MAX_INDEX_LABEL_BYTES / 2);
    let mut state = 93_u64;
    let bytes: Vec<u8> = (0..snapback4_core::rows::MAX_INDEX_KEY_BYTES - 7).map(|_| {
        state ^= state << 13; state ^= state >> 7; state ^= state << 17;
        (state % 255 + 1) as u8
    }).collect();
    let encoded = key::encode(&[Value::Bytes(bytes), id("x")]);
    client.execute("INSERT INTO i VALUES ($1,$2,$3,'x')", &[&label, &label, &encoded]).unwrap();
    println!("KEY_LIMIT: 2048 encoded bytes plus 512 combined label bytes accepted");
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn portable_bound_accepts_exactly_the_limit_and_refuses_the_next_byte_on_both_stores() {
    use snapback4_core::{Engine, schema::ColumnType, rows::{MAX_INDEX_KEY_BYTES, index_key}, value::object};
    let mut bound = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  text: text <=100\n  unique byText: text\n  public 'test'\n  insert <- allow\n  online only\n".into())]);
    assert!(bound.diagnostics.is_empty());
    bound.schema.tables.get_mut("items").unwrap().columns.insert("text".into(), ColumnType::Text { max: 3000 });
    let mut pg = PostgresEngine::create(connect(), &namespace("portable_key"), bound.schema.clone(), []).unwrap();
    let mut sqlite = Engine::memory(bound.schema.clone(), []).unwrap();
    for extra in [0, 1] {
        let identity = format!("r{extra}");
        let row = object([("id", id(&identity)), ("text", string("x".repeat(MAX_INDEX_KEY_BYTES - 8 + extra)))]);
        assert_eq!(index_key(&bound.schema.tables["items"].indexes["byText"], &row, &identity).len(), MAX_INDEX_KEY_BYTES + extra);
        let a = pg.seed_at(vec![("items".into(), row.clone())], 10);
        let b = sqlite.seed_at(vec![("items".into(), row)], 10);
        if extra == 0 { assert_eq!(a.unwrap(), b.unwrap()); }
        else { assert_eq!(a.unwrap_err().code(), "E_INDEX_KEY_BYTES"); assert_eq!(b.unwrap_err().code(), "E_INDEX_KEY_BYTES"); }
    }
}
