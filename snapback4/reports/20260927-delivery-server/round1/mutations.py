from pathlib import Path
import os, subprocess, json
root=Path(__file__).resolve().parents[3]
report=root/'reports/20260927-delivery-server/round1'
env=os.environ.copy(); env['PATH']=os.path.expanduser('~/.local/bin:~/.cargo/bin:')+env['PATH']; env['CARGO_BUILD_JOBS']='4'
cases=[
 ('table-origin', 'crates/snapback4-core/src/engine/delivery.rs', '&& origin.source.table == coordinate.table', '', 'delivery','colliding_ids_do_not_turn_foreign_fields_into_own_images'),
 ('optional-origin', 'crates/snapback4-core/src/engine/runner.rs', ' | Expr::Builtin { builtin: Builtin::OptionalField { .. }, .. }) { self.delivery.last', ') { self.delivery.last', 'delivery','owner_field_origin_survives_optional_access_and_successive_aliases'),
 ('envelope-overcharge', 'crates/snapback4-core/src/engine/delivery.rs', 'let bytes = envelope_bytes(binding) + if bindings.is_empty() { 14 } else { 1 };', 'let bytes = envelope_bytes(binding) + if bindings.is_empty() { 38 } else { 1 };', 'delivery','exact_output_reservation_admits_a_fitting_binding_and_row'),
 ('lost-second-binding', 'crates/snapback4-core/src/engine/delivery.rs', '        if !self.delivery_ledger().partial {\n            walk', '        self.delivery_ledger().partial = false;\n        if !self.delivery_ledger().partial {\n            walk', 'delivery','colliding_ids_do_not_turn_foreign_fields_into_own_images'),
 ('unmetered-index', 'crates/snapback4-core/src/engine/delivery.rs', 'reserve(1 + (i + 1).ilog2() as u64, bytes, 0)', 'reserve(0, bytes, 0)', 'delivery','many_bindings_exhaust_metadata_work_before_further_source_stamping'),
 ('unsafe-position', 'crates/snapback4-core/src/engine/delivery.rs', '        if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&position) { return; }', '', 'delivery','unsafe_positions_are_not_reported_and_safe_endpoints_are_exact'),
]
results=[]
for label,rel,old,new,target,test in cases:
    p=root/rel; original=p.read_text(); assert old in original,label
    try:
        p.write_text(original.replace(old,new,1))
        with (report/f'mutant-{label}.txt').open('w') as log:
            r=subprocess.run(['cargo','test','-p','snapback4-lang','--test',target,test,'--','--exact','--nocapture'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
        text=(report/f'mutant-{label}.txt').read_text()
        killed=r.returncode!=0 and f'test {test} ... FAILED' in text
        results.append({'mutation':label,'test':test,'exit':r.returncode,'killed':killed})
        print(json.dumps(results[-1]),flush=True)
        if not killed: raise RuntimeError(f'mutation survived or did not compile: {label}')
    finally: p.write_text(original)
(report/'mutations.json').write_text(json.dumps(results,indent=2)+'\n')
