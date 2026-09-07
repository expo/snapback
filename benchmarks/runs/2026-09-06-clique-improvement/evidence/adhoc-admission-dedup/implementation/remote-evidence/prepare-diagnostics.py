import pathlib,json,hashlib,shutil
R=pathlib.Path('/home/ccheever/clique-tooling/adhoc-admission-dedup-r1-20260907')
needle='''    ) -> Result<Self, Vec<(String, CheckError)>> {
        let mut errors = Vec::new();'''
injection='''    ) -> Result<Self, Vec<(String, CheckError)>> {
        // Private external diagnostic only: same observer in baseline and candidate.
        if let Ok(path) = std::env::var("S2_PRIVATE_ADMISSION_TRACE") {
            use std::io::Write;
            let event = serde_json::json!({"kind":"Generation::certify", "pid":std::process::id(), "thread":format!("{:?}",std::thread::current().id()), "projectHash":digest(project), "programs":project.programs.iter().map(|p| &p.name).collect::<Vec<_>>()});
            let mut out = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
            writeln!(out, "{}", event).unwrap();
        }
        let mut errors = Vec::new();'''
receipts=[]
for name in ['baseline-diagnostic','candidate-diagnostic']:
 p=R/name/'snapback2/crates/snapback2-core/src/registry.rs';s=p.read_text();assert s.count(needle)==1
 before=hashlib.sha256(p.read_bytes()).hexdigest();p.write_text(s.replace(needle,injection))
 receipts.append(dict(source=name,path=str(p),beforeSha256=before,afterSha256=hashlib.sha256(p.read_bytes()).hexdigest(),injection=injection))
(R/'diagnostic-injection.json').write_text(json.dumps(receipts,indent=2))
print('same private observer injected into both isolated diagnostic sources')
