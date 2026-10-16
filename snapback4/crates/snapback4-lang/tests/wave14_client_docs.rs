use snapback4_lang::{compile, emit};

#[test]
fn generated_docs_preserve_decimal_scale_and_per_operation_prediction_timing() {
    let bound = compile(&[("schema.q".into(), r#"
table amounts:
  owner: principal
  rate: decimal 4
  total: money USD
  samples: [decimal 3] <=4 ?
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation add(rate: decimal 4, total: money USD, samples: [decimal 3] <=4 ?):
  insert amounts {owner: viewer, rate, total, samples}
mutation serverRate(rate: decimal 4): server
  return rate
query rate(rate: decimal 5):
  return {rate}
"#.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let generated = emit::typescript(&bound);
    assert!(generated.contains("Mutation predicts is per operation"));
    assert!(generated.contains("run() waits for sent/failed unless waitSeconds: 0 requests custody"));
    for doc in [
        "rate: decimal 4, integer units; divide by 10^4 for display",
        "total: money USD 2, integer units; divide by 10^2 for display",
        "samples[]: decimal 3, integer units; divide by 10^3 for display",
        "result.rate: decimal 5, integer units; divide by 10^5 for display",
        "Timing: with a device and held facts, a pending row may render before run() settles",
        "Timing: no predicted row; query results change after server settlement and delivery",
    ] { assert!(generated.contains(doc), "missing {doc}:\n{generated}"); }
    assert!(generated.contains("rate: number"), "wire types stay numbers");
}
