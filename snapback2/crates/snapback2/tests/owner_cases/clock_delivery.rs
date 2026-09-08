use super::*;
use snapback2_core::{
    ArgType, Bound, ColumnType, Index, Input, KeyProvenance, Order, Range, Scan, Schema,
    Value as CoreValue, public_table,
};

#[test]
fn timed_query_sse_and_resume_use_the_same_execution_clock_without_a_write() {
    let root = temp_root();
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        "-- Native owner protocol fixture\n",
    )
    .unwrap();
    let index = |names: &[&str]| Index {
        components: names
            .iter()
            .map(|n| snapback2_core::search_key::IndexComponent::Column((*n).into()))
            .collect(),
        unique: names == ["id"],
    };
    let schema = Schema {
        tables: BTreeMap::from([(
            "entries".into(),
            public_table(
                BTreeMap::from([
                    ("id".into(), ColumnType::Id),
                    ("at".into(), ColumnType::Time),
                ]),
                BTreeMap::from([
                    ("byId".into(), index(&["id"])),
                    ("byAt".into(), index(&["at", "id"])),
                ]),
            ),
        )]),
        ..Schema::default()
    };
    let scan = |site: &str, cursor: bool| {
        Expr::Scan(Scan {
            site: site.into(),
            table: "entries".into(),
            index: "byAt".into(),
            prefix: vec![],
            order: Order::Asc,
            take: Bound::Literal(2),
            after: cursor.then(|| Box::new(Expr::Variable("c".into()))),
            before: None,
            range: Some(Range {
                lt: Some(Box::new(Expr::Input(Input::ReadTime))),
                gt: None,
                gte: None,
                lte: None,
            }),
            opaque_cursor: cursor,
            merge_site: None,
            provenance: KeyProvenance::Const,
        })
    };
    let window = Program {
        name: "clock.window".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: Some(1000),
        body: vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("now".into(), Expr::Input(Input::ReadTime)),
            ("items".into(), scan("window", false)),
        ])))],
    };
    let log = Program {
        name: "clock.log".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)))]),
        read_time_granularity_ms: Some(1000),
        body: vec![Stmt::Return(scan("log", true))],
    };
    let untimed = Program {
        name: "clock.untimed".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(CoreValue::Int(7)))],
    };
    let project = ProjectJson {
        version: 1,
        schema,
        programs: vec![window, log, untimed],
        effects: vec![],
        auth: Default::default(),
    };
    Generation::certify(&project, Ceilings::default()).unwrap();
    let future = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        + 100_000;
    // Fixed, typed IR isolates owner execution/projection from compiler packages.
    let compiler = write_worker(
        &root,
        "clock-compiler.mjs",
        &format!(
            r#"
import {{ createInterface }} from 'node:readline';
const project = {};
for await (const line of createInterface({{input:process.stdin}})) {{
 const request=JSON.parse(line); let reply;
 if(request.op==='compile') reply={{project,sources:{{}},apiDts:'',quarry:[],ms:0}};
 else if(request.op==='seed') reply={{seed:{{personas:['alice'],rows:{{entries:[{{id:'old',at:0}},{{id:'future',at:{future}}}]}}}}}};
 else if(request.op==='journeys') reply={{files:[]}};
 else reply={{protocol:'snapback2/compiler-worker/v1',operations:['compile','seed','journeys']}};
 console.log(JSON.stringify({{id:request.id,ok:true,...reply}}));
}}
"#,
            serde_json::to_string(&project).unwrap()
        ),
    );
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let ready = owner.ready_line();
    let port = ready
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let alice = [("X-Snapback-As", "alice")];
    let query = |op: &str, validator: Value| {
        request(
            port,
            "POST",
            "/api/query",
            &alice,
            json!({"op":op,"args":{},"receipt":true,"validator":validator}),
        )
    };
    let first = query("clock.window", Value::Null);
    assert_eq!(first.status, 200, "{}", first.body);
    clock_agrees(&first.body);
    assert_eq!(first.body["data"]["items"].as_array().unwrap().len(), 1);
    let untimed = query("clock.untimed", Value::Null).body;
    assert!(untimed.get("readTime").is_none());
    let mut sse = Sse::open(
        port,
        "/api/subscribe?op=clock.window&args=%7B%7D&receipt=1",
        "alice",
    );
    let initial = sse.event();
    clock_agrees(&initial);
    let advanced = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret)],
        json!({"advanceMs":200_000}),
    );
    assert_eq!(advanced.status, 200);
    let continuing = sse.event();
    clock_agrees(&continuing);
    assert_eq!(continuing["seq"], initial["seq"]);
    assert!(continuing["readTime"].as_i64().unwrap() > initial["readTime"].as_i64().unwrap());
    assert_ne!(continuing["validator"], initial["validator"]);
    assert_eq!(continuing["data"]["items"].as_array().unwrap().len(), 2);
    let conditional = query("clock.window", first.body["validator"].clone()).body;
    clock_agrees(&conditional);
    assert_eq!(conditional["seq"], first.body["seq"]);
    assert_eq!(
        query("clock.untimed", untimed["validator"].clone()).body["state"],
        "unchanged"
    );
    let mut initial_with_old_validator = Sse::open(
        port,
        &format!(
            "/api/subscribe?op=clock.window&args=%7B%7D&receipt=1&validator={}",
            initial["validator"].as_str().unwrap()
        ),
        "alice",
    );
    let initial_full = initial_with_old_validator.event();
    clock_agrees(&initial_full);
    let resume = request(
        port,
        "POST",
        "/api/resume",
        &alice,
        json!({
            "protocol":1,"generation":first.body["generation"],"schemaHash":first.body["schemaHash"],
            "authEpoch":first.body["authority"]["authEpoch"],
            "log":{"op":"clock.log","args":{"c":null},"watermark":null,"validator":""},
            "mounted":[{"op":"clock.window","args":{},"validator":first.body["validator"]}],
        }),
    );
    assert_eq!(resume.status, 200, "{}", resume.body);
    clock_agrees(&resume.body["mounted"][0]);
    assert_eq!(
        resume.body["log"]["readTime"],
        resume.body["log"]["receipt"]["ranges"][0]["lt"]
    );
    assert_eq!(resume.body["mounted"][0]["seq"], first.body["seq"]);
    assert!(resume.body_bytes.len() <= 1_048_576);
    if let Ok(path) = std::env::var("SNAPBACK_CLOCK_EVIDENCE") {
        let custody = request(
            port,
            "GET",
            &format!(
                "/api/program?generation={}",
                first.body["generation"].as_str().unwrap()
            ),
            &alice,
            json!({}),
        );
        assert_eq!(custody.status, 200);
        fs::write(
            path,
            serde_json::to_vec(
                &json!({"project":project,"programCustody":custody.body,"first":first.body,
            "initialSse":initial,"continuingSse":continuing,"conditionalFull":conditional,
            "initialConditionalFull":initial_full,"resume":resume.body,"untimed":untimed}),
            )
            .unwrap(),
        )
        .unwrap();
    }
    stop_owner(port, secret, &mut owner, "clock delivery proof complete");
    fs::remove_dir_all(root).unwrap();
}

fn clock_agrees(frame: &Value) {
    assert_eq!(frame["protocol"], 1, "{frame}");
    assert!(frame["readTime"].is_i64(), "{frame}");
    assert_eq!(frame["readTime"], frame["data"]["now"]);
    assert_eq!(frame["readTime"], frame["receipt"]["ranges"][0]["lt"]);
}
