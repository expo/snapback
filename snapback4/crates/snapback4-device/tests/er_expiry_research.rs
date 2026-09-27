//! Branch-only LLP 3000.025 query-entry witness; custody qualification remains pending.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::ir::ProgramKind;

fn refuses_before_body<H: Host>(host: &mut H) {
    let source = "table messages:\n  owner: principal\n  expiresAt: time ?\n  read <- .owner = viewer\n  expire at .expiresAt\n  sync to .owner\nmutation natural(): server\n  page = messages where .owner = viewer first 1 by .id\n  require false else BODY_RAN\n  return page\n";
    let (_, backend) = compile(source);
    for kind in [ProgramKind::Mutation, ProgramKind::Job] {
        for native in [false,true] {
            let mut backend=backend.clone();
            backend.programs[0].kind=kind;
            backend.programs[0].native=native;
            let mut device=host.open("entry",Some(backend)).unwrap();
            let result=device.query("natural","alice",&json!({}),2000);
            assert_eq!(result.unwrap_err().code,"E_OP","{kind:?} native={native}");
            // Runs before acquisition/coverage and before native dispatch too.
            host.close("entry",device);
        }
    }
}

#[test]
#[ignore = "lane ER round-1 prototype, explicit only"]
fn query_refuses_mutation_and_job_memory() { refuses_before_body(&mut Memory::new()); }
#[test]
#[ignore = "lane ER round-1 prototype, explicit only"]
fn query_refuses_mutation_and_job_native() { refuses_before_body(&mut Sqlite::new("er-query-entry")); }
