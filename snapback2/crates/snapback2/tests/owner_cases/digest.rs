//! Run the actual compiled digest recipe through a durable restart and effect retry.
use super::*;
use snapback2_core::{
    Actor, Bound, ExecutionState, KeyProvenance, OperatorId, Order, OutboxRow, Scan,
    Value as CoreValue, object,
};

const PERIOD: i64 = 120_000;
const CUTOFF: i64 = 2 * PERIOD;
const DIGEST_JOB: &str = "digest-recipes.periodDigestSweep";

fn recipient(n: usize) -> String {
    format!("recipient-{n}")
}

fn compiled_digest(root: &Path) -> Generation {
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-schedules/snapback");
    copy_tree(&source, &root.join("snapback"));
    let checked = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["check", "--project"])
        .arg(root)
        .env("SNAPBACK2_COMPILER", compiler(root))
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{} {}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let project: ProjectJson =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    Generation::certify(&project, Ceilings::default()).unwrap()
}

fn seed_digest(runtime: &mut Runtime) {
    let id = |s: &str| CoreValue::Id(s.into());
    let mut rows = vec![
        (
            "appSettings".into(),
            object([
                ("id", id("windows")),
                ("key", CoreValue::String("windows".into())),
                ("digestPeriodMs", CoreValue::Int(PERIOD)),
                ("replayMode", CoreValue::Bool(false)),
                ("disappear24hMs", CoreValue::Int(86_400_000)),
                ("disappear7dMs", CoreValue::Int(604_800_000)),
            ]),
        ),
        (
            "conversations".into(),
            object([
                ("id", id("chat")),
                ("disappearing", CoreValue::String("off".into())),
            ]),
        ),
        (
            "postPeriodCounters".into(),
            object([
                ("id", id("posts")),
                ("author", id("poster")),
                ("isReply", CoreValue::Bool(false)),
                ("periodStart", CoreValue::Int(PERIOD)),
                ("total", CoreValue::Int(2)),
            ]),
        ),
    ];
    for n in 0..3 {
        let who = recipient(n);
        let member = format!("member-{n}");
        rows.extend([
            (
                "profiles".into(),
                object([
                    ("id", id(&format!("profile-{n}"))),
                    ("principal", id(&who)),
                    ("handle", CoreValue::String(who.clone())),
                    ("newFollowers", CoreValue::Int(0)),
                    ("unreadMessages", CoreValue::Int(0)),
                ]),
            ),
            (
                "memberships".into(),
                object([
                    ("id", id(&member)),
                    ("conversationId", id("chat")),
                    ("principal", id(&who)),
                ]),
            ),
            (
                "follows".into(),
                object([
                    ("id", id(&format!("follow-{n}"))),
                    ("follower", id("poster")),
                    ("followed", id(&who)),
                    ("digestEligible", CoreValue::Bool(true)),
                    ("periodStart", CoreValue::Int(PERIOD)),
                ]),
            ),
            (
                "digestFollows".into(),
                object([
                    ("id", id(&format!("audience-{n}"))),
                    ("follower", id(&who)),
                    ("followed", id("poster")),
                ]),
            ),
        ]);
        for period in [0, PERIOD] {
            let message = format!("message-{n}-{period}");
            rows.push((
                "messages".into(),
                object([
                    ("id", id(&message)),
                    ("conversationId", id("chat")),
                    ("author", id("poster")),
                ]),
            ));
        }
    }
    runtime.seed(&rows).unwrap();
    for n in 0..3 {
        for period in [0, PERIOD] {
            let mut context = CoreContext::mutation(
                Actor::user("poster").unwrap(),
                BTreeMap::from([
                    ("messageId".into(), id(&format!("message-{n}-{period}"))),
                    ("conversationId".into(), id("chat")),
                    ("recipient".into(), id(&recipient(n))),
                ]),
            );
            context.now = Some(period + 1);
            context.new_ids = runtime.reserve_new_ids().unwrap();
            let queued = runtime
                .execute("digest-recipes.queueRecipeUnread", context)
                .unwrap();
            assert!(
                matches!(queued.state, ExecutionState::Committed { .. }),
                "{:?}",
                queued.state
            );
        }
    }
}

fn rows(runtime: &mut Runtime, table: &str) -> Vec<CoreValue> {
    let query = Program {
        name: "digestWitness.rows".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "digestWitness.rows".into(),
            table: table.into(),
            index: "byId".into(),
            prefix: vec![],
            order: Order::Asc,
            take: Bound::Literal(20),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    let result = runtime
        .read_operator(
            &query,
            BTreeMap::new(),
            OperatorId("digest-restart-witness".into()),
            CUTOFF,
        )
        .unwrap();
    let CoreValue::Array(rows) = result.result else {
        panic!("expected table rows");
    };
    rows
}

fn emissions(runtime: &Runtime) -> Vec<OutboxRow> {
    runtime
        .store()
        .outbox_page(None, None, runtime.store().commit_seq().unwrap(), 20)
        .unwrap()
}

fn enqueue(runtime: &mut Runtime, now: i64) -> String {
    runtime
        .enqueue_job_at(
            DIGEST_JOB,
            BTreeMap::from([("cutoff".into(), CoreValue::Int(CUTOFF))]),
            OperatorId("digest-restart-witness".into()),
            now,
        )
        .unwrap()
}

fn finish(runtime: &mut Runtime, job: &str, now: i64) {
    for _ in 0..10 {
        let outcome = runtime.run_chunk_at(job, now).unwrap();
        assert_ne!(outcome.job.state, "parked", "{:?}", outcome.job.last_error);
        if outcome.job.state == "done" {
            return;
        }
    }
    panic!("three profiles and one pruning page did not finish");
}

// @ref LLP 1025.000#1-the-invariant — recipient/period receipt and emission
// commit together; a restart and delivery retry retain the same identity.
#[test]
fn period_digest_restart_preserves_cutoff_receipts_and_one_logical_effect() {
    let root = temp_root();
    let generation = compiled_digest(&root);
    let database = root.join("digest.sqlite");
    let mut runtime = Runtime::open(Store::open(&database).unwrap(), generation.clone()).unwrap();
    seed_digest(&mut runtime);
    let job = enqueue(&mut runtime, CUTOFF);
    let first = runtime.run_chunk_at(&job, CUTOFF).unwrap();
    assert_eq!(first.job.state, "running");
    assert_eq!((first.job.sweep, first.job.chunks), (0, 1));
    assert!(
        first.job.cursor.is_some(),
        "restart must happen inside the profile sweep"
    );
    let first_receipt = rows(&mut runtime, "digests");
    assert_eq!(first_receipt.len(), 1);
    assert_eq!(emissions(&runtime).len(), 1);

    let declared = runtime
        .generation()
        .effects()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let attempt = runtime
        .store()
        .outbox_claim_next(CUTOFF, &declared)
        .unwrap()
        .claimed
        .unwrap();
    assert_eq!(attempt.attempts, 1);
    assert_eq!(
        attempt.payload.field("to").unwrap().as_str().unwrap(),
        recipient(0)
    );
    let retry_at = CUTOFF + 10;
    runtime
        .store()
        .outbox_settle(
            &attempt.id,
            "queued",
            None,
            Some("transient delivery failure"),
            Some(retry_at),
        )
        .unwrap();
    drop(runtime);

    // Reopening at a later clock must not recompute the persisted cutoff.
    let mut runtime = Runtime::open(Store::open(&database).unwrap(), generation).unwrap();
    let recovered = runtime.job_record(&job).unwrap();
    assert_eq!(recovered.state, "queued");
    assert_eq!(recovered.chunks, 1);
    assert_eq!(recovered.cursor, first.job.cursor);
    assert_eq!(recovered.args["cutoff"], CoreValue::Int(CUTOFF));
    assert!(
        runtime
            .store()
            .outbox_claim_next(retry_at - 1, &declared)
            .unwrap()
            .claimed
            .is_none()
    );
    let retry = runtime
        .store()
        .outbox_claim_next(retry_at, &declared)
        .unwrap()
        .claimed
        .unwrap();
    assert_eq!(
        (&retry.id, retry.seq, &retry.payload),
        (&attempt.id, attempt.seq, &attempt.payload)
    );
    assert_eq!(retry.attempts, 2);
    runtime
        .store()
        .outbox_settle(
            &retry.id,
            "sent",
            Some(&json!({"delivered": true})),
            None,
            None,
        )
        .unwrap();

    finish(&mut runtime, &job, CUTOFF + 3 * PERIOD);
    let receipts = rows(&mut runtime, "digests");
    let logs = rows(&mut runtime, "pushLog");
    let emitted = emissions(&runtime);
    assert_eq!((receipts.len(), logs.len(), emitted.len()), (3, 3, 3));
    assert!(
        receipts.contains(&first_receipt[0]),
        "the committed first receipt was replaced"
    );
    for (records, principal) in [(&receipts, "principal"), (&logs, "target")] {
        let mut recipients = records
            .iter()
            .map(|row| {
                assert_eq!(row.field("periodStart").unwrap(), &CoreValue::Int(PERIOD));
                assert_eq!(row.field("periodEnd").unwrap(), &CoreValue::Int(CUTOFF));
                for (metric, expected) in [
                    ("newFollowers", 1),
                    ("newPostsInFollowing", 2),
                    ("unreadMessages", 1),
                    ("unreadChats", 1),
                ] {
                    assert_eq!(
                        row.field(metric).unwrap(),
                        &CoreValue::Int(expected),
                        "{metric}"
                    );
                }
                row.field(principal).unwrap().as_str().unwrap().to_owned()
            })
            .collect::<Vec<_>>();
        recipients.sort();
        assert_eq!(recipients, (0..3).map(recipient).collect::<Vec<_>>());
    }
    let mut targets = emitted
        .iter()
        .map(|row| {
            assert_eq!(row.effect, attempt.effect);
            assert_eq!(
                row.payload.field("body").unwrap().as_str().unwrap(),
                "digest"
            );
            row.payload
                .field("to")
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect::<Vec<_>>();
    targets.sort();
    assert_eq!(targets, (0..3).map(recipient).collect::<Vec<_>>());
    assert_eq!(
        runtime
            .store()
            .outbox_get(&attempt.id)
            .unwrap()
            .unwrap()
            .state,
        "sent"
    );
    assert!(rows(&mut runtime, "digestScratch").is_empty());
    for table in ["periodUnread", "periodChats"] {
        let remaining = rows(&mut runtime, table);
        assert_eq!(remaining.len(), 3, "{table}");
        assert!(
            remaining
                .iter()
                .all(|row| row.field("periodStart").unwrap() == &CoreValue::Int(PERIOD))
        );
    }

    let repeated = enqueue(&mut runtime, CUTOFF + 5 * PERIOD);
    finish(&mut runtime, &repeated, CUTOFF + 5 * PERIOD);
    assert_eq!(rows(&mut runtime, "digests"), receipts);
    assert_eq!(rows(&mut runtime, "pushLog"), logs);
    assert_eq!(
        emissions(&runtime),
        emitted,
        "same cutoff created a second logical effect"
    );
    drop(runtime);
    fs::remove_dir_all(root).unwrap();
}
