Read-only final integration implementation review. Do not edit files, run mutations, run tests, open wave production stores, access publication worktrees/target/publication, or read credential files. Candidate70365904e65a71c3af923faedfc3b0713e3ee1a9 on sb4-loop integrates DX9+REL+DX10 and main, excludes SEC10, bumps0.4.41. Identify material correctness regressions or integration conflicts, with concrete trigger and file/line; otherwise state no material finding. Review content, not HEAD. You have not seen the author's reasoning or other reviews. The accepted contracts require one coherent source-bound security decision rendering (individual gates stay review-tier and retain next steps, authority ahead of lower-ranked audience questions), truthful live release/view identity and current authority retention on rollback/forward, one consistent proof-helper family with bounded process custody, persistent idempotent real production accounts, help/parser agreement, and fresh extraction source context without loosening retained historical meaning. No finite campaign is a universal security proof. The broad final affected run,650copied-schema survey and100copied-store replay are ongoing separately; do not assume their outcomes. The diff below is the integration-specific change after all three lane merges, including main and corrections. Focus on interaction risks; do not request unrelated refactors or reinterpret accepted lane designs.

diff --git a/snapback4/crates/snapback4-core/src/store/extractions.rs b/snapback4/crates/snapback4-core/src/store/extractions.rs
index c8432b7ca2..fea383cb24 100644
--- a/snapback4/crates/snapback4-core/src/store/extractions.rs
+++ b/snapback4/crates/snapback4-core/src/store/extractions.rs
@@ -323,7 +323,12 @@ pub(super) fn transition(
         .filter(|e| previous.is_none_or(|s| !s.extractions.contains(e)))
     {
         e.admit(next).map_err(refuse)?;
-        let parent = sources.get(&e.parent).unwrap_or(&next.tables[&e.parent]);
+        // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — probes retain the selected source definition's schema, including a newly declared parent.
+        let (parent, source_context) = if let Some(parent) = sources.get(&e.parent) {
+            (parent, sources)
+        } else {
+            (&next.tables[&e.parent], &next.tables)
+        };
         let child = &next.tables[&e.child];
         let pt = tx.num(&e.parent)?;
         let ct = tx.num(&e.child)?;
@@ -334,7 +339,7 @@ pub(super) fn transition(
             .as_ref()
             .is_some_and(|t| t.reference == e.reference && t.parent == e.parent);
         let source_read = &parent.rules.read;
-        if !probe_context(source_read,sources,next) {return Err(refuse(format!("extraction {} → {}: source read rule `{}` has changed probe/index meaning; retain its typed lookup context in a bridge",e.parent,e.child,source_read.quarry())));}
+        if !probe_context(source_read,source_context,next) {return Err(refuse(format!("extraction {} → {}: source read rule `{}` has changed probe/index meaning; retain its typed lookup context in a bridge",e.parent,e.child,source_read.quarry())));}
 
         if inherited {
             if !audience_subset(&next.tables[&e.parent].rules.read,source_read) {
@@ -354,7 +359,7 @@ pub(super) fn transition(
             if let Some(parent_gate)=parent.column_reads.get(source) {
                 // Immutable mapped scalar copies are the same authoritative
                 // values, so a stricter child audience can name those copies.
-                if !probe_context(parent_gate,sources,next) {return Err(refuse(format!("extraction {}.{source} → {}.{dest}: source payload rule `{}` has changed probe/index meaning; retain its lookup context in a bridge",e.parent,e.child,parent_gate.quarry())));}
+                if !probe_context(parent_gate,source_context,next) {return Err(refuse(format!("extraction {}.{source} → {}.{dest}: source payload rule `{}` has changed probe/index meaning; retain its lookup context in a bridge",e.parent,e.child,parent_gate.quarry())));}
                 let transported=mapped_audience(parent,child,e,parent_gate);
                 let gate=&transported;
                 let covered=child.column_reads.get(dest).is_some_and(|g|audience_subset(g,gate))
diff --git a/snapback4/crates/snapback4/src/cli_flags.rs b/snapback4/crates/snapback4/src/cli_flags.rs
index 06f6c0d555..97bfc25599 100644
--- a/snapback4/crates/snapback4/src/cli_flags.rs
+++ b/snapback4/crates/snapback4/src/cli_flags.rs
@@ -265,7 +265,7 @@ mod projection_tests {
 
 /// One synopsis for top-level help, per-verb help and usage errors. Flags come
 /// directly from the admission table, including value arity and retired forms.
-pub(crate) const VERBS: &[&str] = &["init","new","audit","check","device","types","dev","deploy","rollback","prune","releases","serve","stop","run","clock","seed","reset","test","why","guide","data","sql","token","doctor","upgrade","witness","web-shell"];
+pub(crate) const VERBS: &[&str] = &["init","new","audit","check","device","types","dev","deploy","rollback","prune","releases","serve","serve-check","stop","run","clock","seed","reset","test","why","guide","data","sql","token","doctor","upgrade","witness","web-shell"];
 pub(crate) fn synopsis(verb: &str) -> String {
     let positional = command(verb).map(|command|command.positional.as_str()).filter(|position|!position.is_empty()).map(|position|format!(" {position}")).unwrap_or_default();
     let mut out = format!("snapback4 {verb}{positional}");
@@ -287,6 +287,7 @@ pub(crate) fn top_help() -> String {
         "deploy"=>"Capture and activate an immutable release; running serve adopts it.", "rollback"=>"Preview or activate an existing release; preserve dormant storage.",
         "prune"=>"Preview or explicitly remove dormant release storage.", "releases"=>"Inspect database-authoritative release history and storage.",
         "serve"=>"Serve the active production release; bearer sessions only, behind a TLS proxy.",
+        "serve-check"=>"Check an npm serve script through the packaged Node CLI; keep credential stdout private.",
         "stop"=>"Gracefully stop the retained server that owns a deployment directory.",
         "run"=>"Run one operation or system job locally or against a serving backend.",
         "clock"=>"Advance the development clock, sweep expiry and run due jobs.", "reset"=>"Empty a development backend and optionally reseed it atomically.",
diff --git a/snapback4/crates/snapback4/src/serve_readers.rs b/snapback4/crates/snapback4/src/serve_readers.rs
index 2046d37c77..6283972dba 100644
--- a/snapback4/crates/snapback4/src/serve_readers.rs
+++ b/snapback4/crates/snapback4/src/serve_readers.rs
@@ -1,5 +1,6 @@
 //! Read checkout is independent of the schema-adoption writer.
 use super::*;
+use snapback4_core::RuntimeError;
 
 // @ref LLP 3000.009.001.000.000#9 — each handoff decodes the original wire arguments against the program that will execute them.
 pub(super) fn query_context(engine: &Engine, shared: &Shared, op: &str, args: &Json, mut context: Context) -> Result<Context, Refusal> {
@@ -20,35 +21,41 @@ pub(super) struct QueryReaders {
     pub(super) epoch: Arc<()>,
     pub(super) idle: Vec<Engine>,
     pub(super) source: Option<Engine>,
+    factories: Vec<Engine>,
+    available: Arc<Condvar>,
     memory: bool,
     pub(super) refusal_sites: Arc<dev_refusals::Sites>,
     #[cfg(test)]
     pub(super) fail_open_after: Option<usize>,
     #[cfg(test)]
     pub(super) retry_open: Option<Arc<dyn Fn() + Send + Sync>>,
+    #[cfg(test)]
+    pub(super) construction_hook: Option<Arc<dyn Fn() + Send + Sync>>,
     candidate_queries: BTreeSet<String>,
     launching_feed: bool,
 }
 
-impl QueryReaders {
-    pub(super) fn take(
-        &mut self,
-        engine: &Engine,
-    ) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
-        self.memory = engine.store().is_memory();
-        if self.source.is_none() {
-            self.source = engine.reader().ok();
+// @ref LLP 3000.009.001.000.002#4.1 — construction owns a bounded factory loan, never the global mutex, including errors/unwind.
+struct FactoryLoan<'a> {
+    shared: &'a Shared,
+    epoch: Arc<()>,
+    engine: Option<Engine>,
+}
+impl Drop for FactoryLoan<'_> {
+    fn drop(&mut self) {
+        let mut readers = lock(&self.shared.readers);
+        if Arc::ptr_eq(&self.epoch, &readers.epoch) {
+            readers.factories.push(self.engine.take().unwrap());
         }
-        let reader = match self.idle.pop() {
-            Some(reader) => reader,
-            None => engine.reader()?,
-        };
-        Ok((self.epoch.clone(), reader))
+        readers.available.notify_all();
     }
+}
 
+impl QueryReaders {
     pub(super) fn put(&mut self, epoch: &Arc<()>, reader: Engine) {
         if Arc::ptr_eq(epoch, &self.epoch) && self.idle.len() < REQUEST_WORKERS {
             self.idle.push(reader);
+            self.available.notify_one();
         }
     }
 
@@ -58,6 +65,8 @@ impl QueryReaders {
         self.epoch = Arc::new(());
         self.idle.clear();
         self.source = None;
+        self.factories.clear();
+        self.available.notify_all();
         self.candidate_queries.clear();
         self.launching_feed = false;
     }
@@ -65,28 +74,37 @@ impl QueryReaders {
 
 impl QueryReaders {
     pub(super) fn new(engine: &Engine, sites: &dev_refusals::Sites) -> Self {
+        // Four independent factory loans bound concurrent construction. They
+        // share PG's fixed physical pool; no connection is borrowed through a
+        // global mutex while connect/qualification runs.
+        let mut source = engine.reader().ok();
+        let factories: Vec<_> = (0..4).filter_map(|_| source.as_ref()?.reader().ok()).collect();
+        if factories.is_empty() { source = None; }
         Self {
-            source: engine.reader().ok(),
+            source,
+            factories,
             refusal_sites: Arc::new(sites.clone()),
             memory: engine.store().is_memory(),
             ..Self::default()
         }
     }
-    pub(super) fn replace(&mut self, engine: &Engine, sites: &dev_refusals::Sites) {
+    pub(super) fn replace(&mut self, prepared: Self) {
         self.invalidate();
-        self.refusal_sites = Arc::new(sites.clone());
-        self.memory = engine.store().is_memory();
-        self.source = engine.reader().ok();
+        self.refusal_sites = prepared.refusal_sites;
+        self.memory = prepared.memory;
+        self.source = prepared.source;
+        self.factories = prepared.factories;
     }
-    // @ref LLP 3000.019#3.6 — retry a failed factory on existing writer work; reads still refuse immediately.
-    pub(super) fn retry_missing(&mut self, engine: &Engine) {
-        if !self.memory && self.source.is_none() {
-            self.source = latency::acquire(|| {
-                #[cfg(test)]
-                if let Some(open) = &self.retry_open { open(); }
-                engine.reader()
-            }).ok();
+    // Startup has no global mutex yet. PG serve readiness includes all 30
+    // detached loans, including their identity/generation qualification.
+    pub(super) fn prepare_population(&mut self, engine: &Engine) -> Result<(), RuntimeError> {
+        #[cfg(feature = "postgres")]
+        if matches!(engine.store(), snapback4_core::store_port::AnyStore::Postgres(_)) {
+            let source = self.source.as_ref().ok_or_else(|| RuntimeError::Store("Postgres reader population unavailable before readiness".into()))?;
+            while self.idle.len() < REQUEST_WORKERS { self.idle.push(source.reader()?); }
         }
+        let _ = engine;
+        Ok(())
     }
     pub(super) fn begin_adoption(&mut self, candidate: &Bound) {
         self.launching_feed = self.source.as_ref().is_some_and(|old| candidate.schema.timelines.iter()
@@ -106,20 +124,16 @@ impl QueryReaders {
     pub(super) fn pending(&self, name: &str) -> bool {
         self.candidate_queries.contains(name)
     }
-    fn detached(&mut self) -> Option<Result<(Arc<()>, Engine), snapback4_core::RuntimeError>> {
+    fn check_open(&mut self) -> Result<(), RuntimeError> {
         #[cfg(test)]
         if let Some(remaining) = &mut self.fail_open_after {
             if *remaining == 0 {
                 self.idle.clear();
-                return Some(Err(snapback4_core::RuntimeError::Store("injected reader-open failure; retry the request".into())));
+                return Err(RuntimeError::Store("injected reader-open failure; retry the request".into()));
             }
             *remaining -= 1;
         }
-        let source = self.source.as_ref()?;
-        Some(match self.idle.pop() {
-            Some(reader) => Ok((self.epoch.clone(), reader)),
-            None => source.reader().map(|reader| (self.epoch.clone(), reader)),
-        })
+        Ok(())
     }
 }
 impl Shared {
@@ -127,18 +141,36 @@ impl Shared {
     // The source is only a connection factory: no transaction, answer or viewer
     // is retained. Identity guards still refuse an obsolete generation.
     pub(super) fn reader(&self) -> Result<(Arc<()>, TimedReader), snapback4_core::RuntimeError> {
-        let (result, sites) = self.acquire_reader(|| {
+        self.acquire_reader(|| loop {
             let start = trace::begin();
             let mut readers = lock(&self.readers);
             trace::waited(start, "readers");
-            (readers.detached(), readers.refusal_sites.clone())
-        });
-        if let Some(result) = result {
-            return result.map(|(epoch, reader)| (epoch, TimedReader { engine: reader, refusal_sites: sites, _timing: latency::EngineSpan::new() }));
-        }
-        // A missing factory can also mean opening a file-backed reader failed.
-        // Never acquire the writer to repair that failure under a read permit.
-        Err(snapback4_core::RuntimeError::Store("detached reader unavailable; retry the request after the store is available".into()))
+            readers.check_open()?;
+            let epoch = readers.epoch.clone();
+            let sites = readers.refusal_sites.clone();
+            let engine = if let Some(reader) = readers.idle.pop() { reader } else {
+                if readers.source.is_none() {
+                    return Err(RuntimeError::Store("detached reader unavailable; retry the request after the store is available".into()));
+                }
+                let Some(factory) = readers.factories.pop() else {
+                    let available = readers.available.clone();
+                    drop(available.wait(readers).unwrap_or_else(|p| p.into_inner()));
+                    continue;
+                };
+                #[cfg(test)]
+                let hook = readers.construction_hook.clone();
+                drop(readers);
+                let loan = FactoryLoan { shared: self, epoch: epoch.clone(), engine: Some(factory) };
+                #[cfg(test)]
+                if let Some(hook) = hook { hook(); }
+                let opened = loan.engine.as_ref().unwrap().reader();
+                drop(loan);
+                readers = lock(&self.readers);
+                if !Arc::ptr_eq(&epoch, &readers.epoch) { continue; }
+                opened?
+            };
+            return Ok((epoch, TimedReader { engine, refusal_sites: sites, _timing: latency::EngineSpan::new() }));
+        })
     }
     pub(super) fn reader_after_handoff(&self) -> Result<(Arc<()>, TimedReader), snapback4_core::RuntimeError> {
         let (epoch, engine, sites) = self.engine.attempt(|engine, shared| {
@@ -162,7 +194,37 @@ impl Shared {
         self.acquire_reader(|| engine.reader())
     }
     pub(super) fn take_reader(&self, engine: &Engine) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
-        self.acquire_reader(|| lock(&self.readers).take(engine))
+        let _ = engine;
+        self.reader().map(|(epoch, reader)| (epoch, reader.into_inner()))
+    }
+    pub(super) fn replace_readers(&self, engine: &Engine, sites: &dev_refusals::Sites) {
+        let prepared = QueryReaders::new(engine, sites);
+        lock(&self.readers).replace(prepared);
+    }
+    // @ref LLP 3000.019#3.6 — repair on existing writer work, outside the reader lock; reads refuse a missing factory.
+    pub(super) fn retry_missing_readers(&self, engine: &Engine) {
+        #[cfg(test)]
+        let hook;
+        let (epoch, sites) = {
+            let readers = lock(&self.readers);
+            if readers.memory || readers.source.is_some() { return; }
+            #[cfg(test)]
+            { hook = readers.retry_open.clone(); }
+            let state = (readers.epoch.clone(), readers.refusal_sites.clone());
+            drop(readers);
+            state
+        };
+        let prepared = latency::acquire(|| {
+            #[cfg(test)]
+            if let Some(hook) = hook { hook(); }
+            QueryReaders::new(engine, &sites)
+        });
+        let mut readers = lock(&self.readers);
+        if Arc::ptr_eq(&epoch, &readers.epoch) && readers.source.is_none() {
+            readers.source = prepared.source;
+            readers.factories = prepared.factories;
+            readers.available.notify_all();
+        }
     }
     pub(super) fn memory_store(&self) -> bool { lock(&self.readers).memory }
 
diff --git a/snapback4/crates/snapback4/src/serve_start.rs b/snapback4/crates/snapback4/src/serve_start.rs
index 8b9121b964..9c5798970e 100644
--- a/snapback4/crates/snapback4/src/serve_start.rs
+++ b/snapback4/crates/snapback4/src/serve_start.rs
@@ -192,7 +192,9 @@ pub fn serve(
     let registration = if dev { Some(crate::dev_hosts::register(&project.root, address,
         engine.store().store_identity().map_err(|e|e.to_string())?.unwrap_or_default(),
         matches!(mode, Mode::Dev {fresh:true,..}), host_owner.as_ref().and_then(|o| o.path().ok()).map(std::path::Path::to_path_buf))?) } else {None};
-    let readers = Mutex::new(QueryReaders::new(&engine, &bound.refusal_sites));
+    let mut readers = QueryReaders::new(&engine, &bound.refusal_sites);
+    readers.prepare_population(&engine).map_err(|e| e.to_string())?;
+    let readers = Mutex::new(readers);
     let shared = Arc::new(Shared {
         carried: Mutex::new(BTreeMap::new()),
         dev_reset_store: Mutex::new(None),
diff --git a/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs b/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs
index c4aa21808a..9779b3e022 100644
--- a/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs
+++ b/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs
@@ -23,24 +23,30 @@ pub(in crate::verbs) fn render(dispositions: &[Disposition], notes: &[Diagnostic
     use std::fmt::Write;
     let mut output=String::new();
     let mut ordered=notes.iter().zip(dispositions).collect::<Vec<_>>();
+    // @ref LLP 3000.036.004#165-review-clarification-exact-detector-and-command-boundaries — grouping must preserve gate/authority priority.
     ordered.sort_by_key(|(n,_)|(crate::note_rank::summary_order(&n.code),n.site.file.clone(),n.site.line,n.site.col));
     let members=ordered.iter().filter(|(_,d)|d.family.is_some()&&!d.acknowledged).collect::<Vec<_>>();
+    let mut family_output=String::new();
     if let Some((_,first))=members.first().copied() {
         let codes=members.iter().map(|(n,_)|n.code.as_str()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ");
-        writeln!(&mut output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
+        writeln!(&mut family_output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
         for (n,_) in &members {
             // The expanded branch cross-product stays in JSON. One question
             // names the source subject without repeating every equivalent path.
             let subject = n.message.split(" matches or weakens").next().unwrap_or(&n.message)
                 .split(": ").next().unwrap_or(&n.message);
-            writeln!(&mut output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
+            writeln!(&mut family_output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
         }
-        writeln!(&mut output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
-        writeln!(&mut output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
+        writeln!(&mut family_output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
+        writeln!(&mut family_output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
     }
+    let mut family_printed=false;
     for (n,d) in ordered {
         if d.acknowledged { writeln!(&mut output,"security reviewed {} {}: {}",d.id,d.code,d.reason.as_deref().unwrap_or("")).unwrap(); continue; }
-        if d.family.is_some() { continue; }
+        if d.family.is_some() {
+            if !family_printed {output.push_str(&family_output);family_printed=true;}
+            continue;
+        }
         if crate::note_rank::tier(&n.code)!=crate::note_rank::Tier::Review { continue; }
         let subject=n.message.split(": ").next().unwrap_or(&n.message);
         let concise=match n.code.as_str() {
@@ -62,6 +68,16 @@ pub(in crate::verbs) fn render(dispositions: &[Disposition], notes: &[Diagnostic
 
 #[cfg(test)]mod tests {
  use super::*;
+ #[test]fn authority_and_gates_precede_one_complete_audience_family(){
+  let codes=["N_BROAD_READ","N_PRIVILEGE_ESCALATION","N_OPTIONAL_UPLOAD_CREATE","N_INVARIANT_RESTATES_RULE"];
+  let notes=codes.iter().map(|code|Diagnostic::new(&Default::default(),*code,"subject: review authority","repair enforcement")).collect::<Vec<_>>();
+  let dispositions=codes.iter().map(|code|Disposition{family:audience(code).then(||"audience:family".into()),id:(*code).into(),code:(*code).into(),site:"schema.q:1:1".into(),gated:gated(code),acknowledged:false,reason:None,scope:"test".into()}).collect::<Vec<_>>();
+  let text=render(&dispositions,&notes);
+  assert!(text.find("decision N_OPTIONAL_UPLOAD_CREATE").unwrap()<text.find("decision N_PRIVILEGE_ESCALATION").unwrap(),"{text}");
+  assert!(text.find("decision N_PRIVILEGE_ESCALATION").unwrap()<text.find("decision audience").unwrap(),"{text}");
+  assert_eq!(text.matches("decision audience").count(),1,"{text}");
+  assert!(text.contains("Are these 2 row/column audiences")&&text.contains("audience:family"),"{text}");
+ }
  #[test]fn every_gate_is_one_decision_and_never_a_family_member(){
   for code in snapback4_lang::security::GATED_NOTE_CODES {
    assert!(!audience(code));
diff --git a/snapback4/packages/snapback4/bin/cli-commands.json b/snapback4/packages/snapback4/bin/cli-commands.json
index 5f005b9e89..1083873152 100644
--- a/snapback4/packages/snapback4/bin/cli-commands.json
+++ b/snapback4/packages/snapback4/bin/cli-commands.json
@@ -11,6 +11,7 @@
   {"verb":"prune","positional":"<dir>","flags":[{"name":"allow-destructive","value":""},{"name":"json","value":""},{"name":"store-url","value":"URL"}]},
   {"verb":"releases","positional":"<dir> [N|latest|current]","flags":[{"name":"after","value":"VALUE"},{"name":"items-after","value":"VALUE"},{"name":"event","value":"VALUE"},{"name":"json","value":""},{"name":"store-url","value":"URL"}]},
   {"verb":"serve","positional":"<dir>","flags":[{"name":"wait-stopped","value":""},{"name":"port","value":"N|A-B"},{"name":"bind","value":"VALUE"},{"name":"worker","value":"path"},{"name":"i-understand-cleartext","value":""},{"name":"long-waits","value":"N"},{"name":"long-waits-per-principal","value":"N"},{"name":"claim-waits","value":"N"},{"name":"clock-offset","value":"<duration>"},{"name":"store-url","value":"URL"},{"name":"worker-state-dir","value":"PATH"},{"name":"store","value":"PATH"}]},
+  {"verb":"serve-check","positional":"","flags":[{"name":"deployment","value":"DIR"},{"name":"script","value":"NAME"},{"name":"up-ms","value":"N"},{"name":"timeout-ms","value":"N"}]},
   {"verb":"stop","positional":"<dir>","flags":[{"name":"store-url","value":"URL"},{"name":"store","value":"PATH"}]},
   {"verb":"run","positional":"<operation> [json-args]","flags":[{"name":"as","value":"persona|principal"},{"name":"port","value":"N"},{"name":"now","value":"VALUE"},{"name":"json","value":""},{"name":"release","value":"dir"},{"name":"token-env","value":"NAME"},{"name":"store-url","value":"URL"}]},
   {"verb":"clock","positional":"advance <duration> | drain","flags":[{"name":"each-boundary","value":""},{"name":"port","value":"N"},{"name":"release","value":"<dir>"},{"name":"no-drain","value":""},{"name":"allow-held","value":""},{"name":"expire-sessions","value":""}]},
diff --git a/snapback4/packages/snapback4/bin/snapback4.js b/snapback4/packages/snapback4/bin/snapback4.js
index c397c68706..8c925a1fd8 100755
--- a/snapback4/packages/snapback4/bin/snapback4.js
+++ b/snapback4/packages/snapback4/bin/snapback4.js
@@ -1,4 +1,5 @@
 #!/usr/bin/env node
+import { synopsis } from "./cli-usage.js";
 // `npx snapback4 <verb>`: the Rust binary, found in the platform package
 // installed beside this one, or named by SNAPBACK4_BIN, or built in this
 // repository. The JavaScript here only finds and runs it, and the two live and
@@ -27,7 +28,7 @@ if (process.argv[2] === "serve-check") {
   try {
     const args = process.argv.slice(3), options = {};
     if (args.includes("--help")) {
-      console.log("usage: snapback4 serve-check --deployment DIR [--script prod:serve] [--up-ms 30000] [--timeout-ms 30000]");
+      console.log(`usage: ${synopsis("serve-check")}`);
       process.exit(0);
     }
     const keys = {"--deployment":"deployment", "--script":"script", "--up-ms":"upMs", "--timeout-ms":"timeoutMs"};
