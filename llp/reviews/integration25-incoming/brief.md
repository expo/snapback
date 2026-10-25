Read-only independent integration review at030a1ab426. Do not edit, run tests, open original wave stores, read credential files or visit publication worktrees/target/publication. Identify material interaction regressions with concrete triggers, otherwise state no material finding. Focus the auto-merged release code: REL extraction/reverse receipts plus incoming activation expected-image tracking, legal backfills, and current authority retention. The incoming Postgres G7.1 and FF3 content is already qualified upstream and merged without code conflicts; journals and deploy documentation resolve by preserving both contracts. Review the resulting content, not commit identity or assumed test outcomes. No normative amendment or new capacity claim is made. The diff below is against upstream main; you may inspect local source context read-only.

diff --git a/snapback4/crates/snapback4-core/src/store/backfills.rs b/snapback4/crates/snapback4-core/src/store/backfills.rs
index a45ae251a4..035115a673 100644
--- a/snapback4/crates/snapback4-core/src/store/backfills.rs
+++ b/snapback4/crates/snapback4-core/src/store/backfills.rs
@@ -457,8 +457,8 @@ pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,source
     }
     // A name is immutable within a continuous lineage. Replacing a transform
     // deliberately goes through an old-source/bridge transition first.
-    if let Some(old)=previous {for f in &next.backfills {if let Some(p)=old.backfills.iter().find(|p|p.table==f.table && p.name==f.name && p.key()!=f.key()) {return Err(refusal(format!("backfill {} {} changed historical meaning; old digest {}; new digest {}; use a new name in a bridge release rather than replacing historical meaning",f.table,f.name,p.key(),f.key())));}}}
-    if let Some(old)=previous {for f in &next.downfills {if let Some(p)=old.downfills.iter().find(|p|p.table==f.table && p.name==f.name && p.down_key()!=f.down_key()) {return Err(refusal(format!("down {} {} changed historical meaning; old digest {}; new digest {}; use a new name in a bridge release rather than replacing historical meaning",f.table,f.name,p.down_key(),f.down_key())));}}}
+    if let Some(old)=previous {for f in &next.backfills {if let Some(p)=old.backfills.iter().find(|p|p.table==f.table && p.name==f.name && p.key()!=f.key()) {return Err(refusal(format!("backfill {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",f.table,f.name,p.key(),f.key())));}}}
+    if let Some(old)=previous {for f in &next.downfills {if let Some(p)=old.downfills.iter().find(|p|p.table==f.table && p.name==f.name && p.down_key()!=f.down_key()) {return Err(refusal(format!("down {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",f.table,f.name,p.down_key(),f.down_key())));}}}
     // Names keep one meaning throughout durable store history, including gaps
     // without the table or declaration. A different transform needs a new name.
     let mut known=tx.conn().prepare("SELECT octet_length(definition),definition FROM _backfill_definitions ORDER BY digest")?;
@@ -467,7 +467,7 @@ pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,source
         let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((row.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
         let old:Backfill=decode(&row.get::<_,String>(1)?)?;
         if let Some(new)=next.backfills.iter().find(|f|f.table==old.table && f.name==old.name && f.key()!=old.key()) {
-            return Err(refusal(format!("backfill {} {} changed historical meaning; old digest {}; new digest {}; use a new name in a bridge release",old.table,old.name,old.key(),new.key())));
+            return Err(refusal(format!("backfill {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",old.table,old.name,old.key(),new.key())));
         }
     }
     let mut known_down=tx.conn().prepare("SELECT octet_length(definition),definition FROM _downfill_definitions ORDER BY digest")?;
@@ -476,7 +476,7 @@ pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,source
         let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((row.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
         let old:Backfill=decode(&row.get::<_,String>(1)?)?;
         if let Some(new)=next.downfills.iter().find(|f|f.table==old.table && f.name==old.name && f.down_key()!=old.down_key()) {
-            return Err(refusal(format!("down {} {} changed historical meaning; old digest {}; new digest {}; use a new name in a bridge release",old.table,old.name,old.down_key(),new.down_key())))
+            return Err(refusal(format!("down {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",old.table,old.name,old.down_key(),new.down_key())))
         }
     }
     for fill in &next.backfills {
@@ -507,6 +507,14 @@ pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,source
                 if !table.columns.contains_key(c){e.retained.insert(c.clone());continue;}
 
                 let current=fields.get(c);let before=e.before.get(c);let after=e.after.get(c);
+                // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — an inactive receipt is history, not a competing live output owner.
+                if !e.active {
+                    let successor:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_evidence e JOIN _backfill_definitions d ON d.digest=e.definition, json_each(d.definition,'$.outputs') output WHERE e.t=?1 AND e.id=?2 AND e.active=1 AND e.definition!=?3 AND output.value=?4)",params![t,id,key,c],|r|r.get(0))?;
+                    let reentering=next.backfills.iter().any(|f|f.table==fill.table&&f.key()!=key&&f.outputs.contains(c));
+                    let accepted_view=e.reversed.get(c).is_some_and(|v|v.as_ref()==current);
+                    if successor || (reentering&&accepted_view) {continue;}
+                }
+
                 if (current!=after && current!=before) || e.authored.contains(c) {
                     let projected=if down_pending {
                         let patches:Vec<String>=tx.conn().prepare("SELECT patch FROM temp._downfill_pending WHERE t=?1 AND id=?2")?.query_map(params![t,id],|r|r.get(0))?.collect::<Result<_,_>>()?;
@@ -674,6 +682,15 @@ pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,source
             let fields=current.as_object()?;let mut before=BTreeMap::new();let mut desired=patch.clone();
             let mut preimage_meter=Meter::new(Ceilings::job(),Cut::Abort);
             for (c,value) in &patch {
+                // A new transform may consume an older receipt's accepted view,
+                // but cannot overwrite a distinct retained authored native value.
+                let others:Vec<String>=tx.conn().prepare("SELECT definition FROM _backfill_evidence WHERE t=?1 AND id=?2 AND active=0 AND definition!=?3 AND retained_outputs!='[]'")?.query_map(params![t,id,key],|r|r.get(0))?.collect::<Result<_,_>>()?;
+                for other in others {if let Some(retained)=evidence(tx,t,id,&other)? {
+                    if retained.retained.contains(c)&&retained.authored.contains(c)&&retained.after.get(c)!=Some(value)
+                        &&retained.reversed.get(c).is_some_and(|view|view.as_ref()==current.field(c).ok()) {
+                        bad.add(id,&format!("{}.{} retained authored output {} conflicts with new backfill {} computation {}; select a bridge that exposes the retained native value, repair it through an authorized mutation, then preview the new named transform",fill.table,c,display_cell(retained.after.get(c)),fill.name,display_cell(Some(value))));return Ok(())
+                    }
+                }}
                 if let Err(e)=validate_output(&fill.table,table,c,value) {bad.add(id,&e.to_string());return Ok(())}
                 if let Some(kind)=row_source.as_deref().and_then(|t|t.columns.get(c)) {if protected(kind) && prior.as_ref().is_none_or(|e|e.before.contains_key(c)) {bad.add(id,&format!("cannot overwrite historical reference or asset {}.{c}; derive into a new column",fill.table));return Ok(())}}
                 if prior.is_none() && fill.name.starts_with("$rename:up:") {
diff --git a/snapback4/crates/snapback4-core/src/store/extractions.rs b/snapback4/crates/snapback4-core/src/store/extractions.rs
index 5c463e4435..6ee826bc37 100644
--- a/snapback4/crates/snapback4-core/src/store/extractions.rs
+++ b/snapback4/crates/snapback4-core/src/store/extractions.rs
@@ -23,6 +23,35 @@ fn asset(k: &ColumnType) -> bool {
         _ => false,
     }
 }
+// Closed audience inclusion: equality, deny, and Boolean conjunction/union.
+// This never infers a business relation between different atomic predicates.
+fn audience_subset(next:&crate::schema::RuleExpr,source:&crate::schema::RuleExpr)->bool{
+    use crate::schema::RuleExpr::*;
+    next==source || *next==Deny || *source==Allow || match (next,source) {
+        (Or(xs),_)=>xs.iter().all(|x|audience_subset(x,source)),
+        (_,And(xs))=>xs.iter().all(|x|audience_subset(next,x)),
+        (And(xs),_)=>xs.iter().any(|x|audience_subset(x,source)),
+        (_,Or(xs))=>xs.iter().any(|x|audience_subset(next,x)),
+        _=>false,
+    }
+}
+fn mapped_audience(parent:&Table,child:&Table,e:&Extraction,rule:&crate::schema::RuleExpr)->crate::schema::RuleExpr{
+    let mut transported=parent.clone();
+    let names=parent.columns.keys().map(|source|{
+        let copy=e.fields.iter().find(|(_,old)|*old==source).filter(|(dest,_)|!asset(&child.columns[*dest])&&child.constraints.iter().any(|c|matches!(c,crate::schema::Constraint::Immutable{fields}if fields.contains(*dest))));
+        (source.clone(),copy.map(|(dest,_)|dest.clone()).unwrap_or_else(||format!("$extraction-source:{source}")))
+    }).collect();
+    transported.column_reads=BTreeMap::from([("$gate".into(),rule.clone())]);
+    super::asset_renames::table(&mut transported,&names);
+    transported.column_reads.remove("$gate").unwrap()
+}
+fn probe_context(rule:&crate::schema::RuleExpr,sources:&BTreeMap<String,Table>,next:&Schema)->bool{
+    use crate::schema::RuleExpr::*;
+    match rule {
+        Exists{table,index,..}|Created{table,index,..}=>sources.get(table).zip(next.table(table)).is_some_and(|(old,new)|old.index(index)==new.index(index)&&old.rules.read==new.rules.read),
+        And(xs)|Or(xs)=>xs.iter().all(|r|probe_context(r,sources,next)),Not(r)=>probe_context(r,sources,next),_=>true,
+    }
+}
 fn fields(row: &mut Value) -> Result<&mut crate::value::ObjectFields, RuntimeError> {
     match row {
         Value::Row(f) | Value::Map(f) => Ok(f),
@@ -219,8 +248,8 @@ pub(super) fn transition(
                 })?;
                 if found.len() > 1 {
                     return Err(refuse(format!(
-                        "extraction {} parent {id}: several child rows compete for the old asset; declare a truthful bridge",
-                        e.child
+                        "extraction {} parent {id} via {}: several child rows compete for {}; run rollback --check --bridge <new-dir>, keep the child population visible, choose a truthful old representation with an authorized mutation, then preview exact rollback",
+                        e.child,e.reference,e.fields.keys().cloned().collect::<Vec<_>>().join(", ")
                     )));
                 }
                 let Some(child) = found.pop() else {
@@ -258,10 +287,9 @@ pub(super) fn transition(
                 if !parent.columns.contains_key(source) {
                     continue;
                 }
-                if parent.columns[source] != *kind {
-                    return Err(refuse("reverse extraction requires identical asset types"));
-                }
                 let v = image.field(destination)?.clone();
+                crate::engine::validate::validate_column(&e.parent,source,&parent.columns[source],Some(&v))
+                    .map_err(|error|refuse(format!("reverse extraction {}.{} → {}.{source}: {error}; keep a widened bridge, repair this child through an authorized mutation, then preview exact rollback",e.child,destination,e.parent)))?;
                 retain_cell(tx, &key, pt, id, source, &v)?;
                 transfer(
                     tx,
@@ -296,7 +324,12 @@ pub(super) fn transition(
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
@@ -307,24 +340,16 @@ pub(super) fn transition(
             .as_ref()
             .is_some_and(|t| t.reference == e.reference && t.parent == e.parent);
         let source_read = &parent.rules.read;
+        if !probe_context(source_read,source_context,next) {return Err(refuse(format!("extraction {} → {}: source read rule `{}` has changed probe/index meaning; retain its typed lookup context in a bridge",e.parent,e.child,source_read.quarry())));}
+
         if inherited {
-            if next.tables[&e.parent].rules.read != *source_read {
+            if !audience_subset(&next.tables[&e.parent].rules.read,source_read) {
                 return Err(refuse(
                     "asset extraction cannot broaden the inherited parent read policy; stage an explicit policy change separately",
                 ));
             }
         } else if child.rules.read != crate::schema::RuleExpr::Deny {
-            if child.rules.read != *source_read
-                || source_read.any_term(&|term| {
-                    matches!(
-                        term,
-                        crate::schema::RuleTerm::Field(_)
-                            | crate::schema::RuleTerm::OldField(_)
-                            | crate::schema::RuleTerm::NextField(_)
-                            | crate::schema::RuleTerm::Reference { .. }
-                            | crate::schema::RuleTerm::ReferenceChain { .. }
-                    )
-                })
+            if !audience_subset(&child.rules.read,&mapped_audience(parent,child,e,source_read))
             {
                 return Err(refuse(
                     "asset extraction requires read through its parent for row-dependent privacy; the destination cannot broaden the source audience",
@@ -332,11 +357,16 @@ pub(super) fn transition(
             }
         }
         for (dest, source) in &e.fields {
-            let parent_gate = parent.column_reads.get(source);
-            if parent_gate.is_some() && child.column_reads.get(dest) != parent_gate {
-                return Err(refuse(
-                    "asset extraction must preserve the source column's read policy",
-                ));
+            if let Some(parent_gate)=parent.column_reads.get(source) {
+                // Immutable mapped scalar copies are the same authoritative
+                // values, so a stricter child audience can name those copies.
+                if !probe_context(parent_gate,source_context,next) {return Err(refuse(format!("extraction {}.{source} → {}.{dest}: source payload rule `{}` has changed probe/index meaning; retain its lookup context in a bridge",e.parent,e.child,parent_gate.quarry())));}
+                let transported=mapped_audience(parent,child,e,parent_gate);
+                let gate=&transported;
+                let covered=child.column_reads.get(dest).is_some_and(|g|audience_subset(g,gate))
+                    || (inherited&&audience_subset(&next.tables[&e.parent].rules.read,parent_gate))
+                    || (!inherited&&audience_subset(&child.rules.read,gate));
+                if !covered {return Err(refuse(format!("extraction {}.{source} → {}.{dest}: preserve source read rule `{}` on the child column or through its parent; an authored stricter audience is allowed",e.parent,e.child,parent_gate.quarry())));}
             }
         }
         let populated: bool =
@@ -356,14 +386,14 @@ pub(super) fn transition(
             let kind = parent.columns.get(source).ok_or_else(|| {
                 refuse(format!("extraction source {}.{source} is absent", e.parent))
             })?;
-            let same = if e.each && asset(&child.columns[dest]) {each::item_type(kind)==Some(&child.columns[dest])} else {kind == &child.columns[dest]};
+            let same = if e.each && asset(&child.columns[dest]) {each::item_type(kind)==Some(&child.columns[dest])} else {kind == &child.columns[dest] || matches!(&child.columns[dest],ColumnType::Optional(inner) if inner.as_ref()==kind)};
             if !same
                 || parent.engine_field(source)
                 || parent.maintained.contains_key(source)
                 || parent.written_by.contains_key(source)
             {
                 return Err(refuse(
-                    "extraction requires identical authoritative source and destination types",
+                    format!("extraction {}.{source} → {}.{dest} requires identical authoritative types or required → optional widening",e.parent,e.child),
                 ));
             }
             if asset(kind) && next.tables[&e.parent].columns.contains_key(source) {
@@ -407,7 +437,7 @@ pub(super) fn transition(
                     continue;
                 };
                 if asset(kind) {
-                    if image.field(destination).is_ok_and(|old| old != &v) {
+                    if image.field(destination).is_ok_and(|old| old != &v && !(saved.is_some() && old == &Value::Null)) {
                         return Err(refuse(
                             "extraction destination asset conflicts with its source",
                         ));
diff --git a/snapback4/crates/snapback4-lang/src/guide/deploy.md b/snapback4/crates/snapback4-lang/src/guide/deploy.md
index 09ffa2fe8b..2eb545ee90 100644
--- a/snapback4/crates/snapback4-lang/src/guide/deploy.md
+++ b/snapback4/crates/snapback4-lang/src/guide/deploy.md
@@ -105,6 +105,7 @@ This roster is synced. A whole service-seat branch may add the first member; ord
 
 ## Migrations and adoption (SQLite)
 Optional/defaulted columns, new tables/ops, non-unique indexes and wider types are additive. Required new fields need a literal default or a declarative `backfill table name(fields: types): {column: expression}`; default now/viewer cannot invent historical values. Dev check/adoption refuses incompatible values with E_ADOPT. Release type narrowing instead retains each row whose present values cannot fit. Unique/cap conflicts still refuse atomically; repair active rows, or restore through a widened non-unique bridge, repair, then reinstate constraints. Prefer expand → migrate → contract for client compatibility. Generations climb on actual switches, including rollback/forward; identical execution content is a no-op.
+For a complete field/enum rename with stored edits and v2-native rows, run `guide rename`.
 
 ## Which migration shape survives edits and rollback?
 Choose the shape before writing a migration:
@@ -122,19 +123,17 @@ Preview rollback after a v2 edit, forward after a v1 edit, and v2-native rows wi
 bunx snapback4 rollback ./deployment --to 1 --check
 bunx snapback4 rollback ./deployment --to 1
 ```
-`deploy ./deployment --check` previews deploy direction and restoration intent. `bunx snapback4 check --store ./deployment/store.sqlite --release 1` also previews a selection; `bunx snapback4 releases ./deployment latest` inspects it. Forward with `bunx snapback4 rollback ./deployment --to latest`. Preview runs exact adoption on a private disk snapshot and removes it, without activating; disk/time scales with the store, and later writes can change the plan. Release is immutable source; latest is the highest successfully adopted source even after rollback. A refused deploy removes its candidate directory and private stage. An ambiguous reply preserves source until committed history resolves the outcome; inspect releases before retrying. Bare rollback selects the previously active release; rollback prints the resolved target before preview or activation. Generation is a monotone identity; releases N/latest inspects source. Source identical to the active release is a no-op; source matching a retained release reactivates its existing id with restoration and full validation. Deploy/rollback return after serve switches: `release N is current as generation G`. In-flight one-shot operations finish in their generation; no settle sleep is needed. Default adoption is one measured receipt; --verbose/--json includes phases/cache advice. N_ADOPTION_PAUSE appears above one second. Deploy/rollback wait up to five seconds for a shutting-down store owner before admission; live serve keeps its authenticated control path. A remaining owner refuses with E_STORE_BUSY; stop that owned process before retrying. Failed or ambiguous activation is never automatically replayed. `await host.stop()` from startServe waits for its native child and the kernel store lock, including delayed worker cleanup, before resolving. `snapback4 stop ./deployment` asks the retained owner to shut down through its same-owner private control socket and waits for the store lock; it never signals a recorded PID or removes a lock. `serve ./deployment --wait-stopped` remains the bounded five-second lock barrier after a caller has already requested shutdown; it neither stops a process nor opens SQLite. It refuses other serve flags. A timeout rejects cleanup rather than claiming the store is free.
-Widened enum values, or short codes a loose release wrote, become dormant rows when selected types cannot hold them; compatible forward restores exact values. Reference dependents also leave the active population. Rules, counts, maintained views and reacquired sync partitions see only active rows. Point reads/updates/ deletes see absent rows; dormant ids stay reserved. Nominal reference values stay legal, as for other missing ids; require/read-through decides live-target admission. Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair. Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs --restore-dormant; selecting retained source by deploy or rollback already selects restoration. The same --restore-dormant flag is accepted by both commands. Old active updates keep dormant cells; active deletion removes them. Only active referential actions run: parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible references stay dormant; whole-table/column restoration retains its E_ADOPT barrier. Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive` permanently drops all dormant storage. No age collector or implicit pruning exists. Deploy/rollback --allow-destructive bypasses neither validation nor retention. --allow-feed-adoption permits the explicit feed launch. Inspect releases after an ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).
+`deploy ./deployment --check` previews deploy direction and restoration intent. `bunx snapback4 check --store ./deployment/store.sqlite --release 1` also previews a selection; `bunx snapback4 releases ./deployment latest` inspects it. Forward with `bunx snapback4 rollback ./deployment --to latest`. Preview runs exact adoption on a private disk snapshot and removes it, without activating; disk/time scales with the store, and later writes can change the plan. Release is immutable source; latest is the highest successfully adopted source even after rollback. A refused deploy removes its candidate directory and private stage. An ambiguous reply preserves source until committed history resolves the outcome; inspect releases before retrying. Bare rollback selects the previously active release; rollback prints the resolved target before preview or activation. Generation is a monotone identity; releases N/latest inspects source. Source identical to an active ordinary release is a no-op; a deploy equal to an ordinary release selects that release when its rollback view is live. source matching a retained release reactivates its existing id with restoration and full validation. Deploy/rollback return after serve switches: `release N is current as generation G`. In-flight one-shot operations finish in their generation; no settle sleep is needed. Default adoption is one measured receipt; --verbose/--json includes phases/cache advice. N_ADOPTION_PAUSE appears above one second. Deploy/rollback wait up to five seconds for a shutting-down store owner before admission; live serve keeps its authenticated control path. A remaining owner refuses with E_STORE_BUSY; stop that owned process before retrying. Failed or ambiguous activation is never automatically replayed. `await host.stop()` from startServe waits for its native child and the kernel store lock, including delayed worker cleanup, before resolving. `snapback4 stop ./deployment` asks the retained owner to shut down through its same-owner private control socket and waits for the store lock; it never signals a recorded PID or removes a lock. `serve ./deployment --wait-stopped` remains the bounded five-second lock barrier after a caller has already requested shutdown; it neither stops a process nor opens SQLite. It refuses other serve flags. A timeout rejects cleanup rather than claiming the store is free. Widened enum values, or short codes a loose release wrote, become dormant rows when selected types cannot hold them; compatible forward restores exact values. Reference dependents also leave the active population. Rules, counts, maintained views and reacquired sync partitions see only active rows. Point reads/updates/ deletes see absent rows; dormant ids stay reserved. Nominal reference values stay legal, as for other missing ids; require/read-through decides live-target admission. Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair. Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs --restore-dormant; selecting retained source by deploy or rollback already selects restoration. The same --restore-dormant flag is accepted by both commands. Old active updates keep dormant cells; active deletion removes them. Only active referential actions run: parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible references stay dormant; whole-table/column restoration retains its E_ADOPT barrier. Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive` permanently drops all dormant storage. No age collector or implicit pruning exists. Deploy/rollback --allow-destructive bypasses neither validation nor retention. --allow-feed-adoption permits the explicit feed launch. Inspect releases after an ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).
+
+`releases --json` reports `live.{source, view, exact}`: source is the logical ordinary release, view is the selected compiled-view id or null, and exact distinguishes original source. A view also names its registration parent. Default view writes use its compiled guarded workflow, including current defaults/operations when retained; `--exact` requests the immutable original source and still enforces write-authority compatibility.
 
 ## Visible rollback by default (SQLite)
-Deploy prepares compiled rollback views when a predecessor cannot hold newly allowed values. With current independent intent, changed source also prepares a view without widening, so a repaired workflow cannot silently roll back to its unsafe old body. These views retain the complete authored current schema, helpers, programs and policy while admitting old names and inputs; unsupported mappings require authored compatible guarded source. Old inputs may fit wider same-format text/list bounds or omit new optional arguments; narrowed or removed inputs still refuse. `rollback --to 1` selects release 1's registered view in the active deployment's context, retaining current guards and widened domains; output names both original and actual ids. The original source remains immutable. After upgrading the CLI/runtime, restart an older running serve before switching releases; an older host refuses the new custody control feature before admission. `--exact` deliberately selects that source and reports its dormant population. Newer views never become ordinary latest. If a guard cannot be transported safely or a view cannot compile, deploy refuses until source supplies a compatible workflow. Nullable old results remain a client compatibility change: render an amount still to follow as pending, never zero. Optional media must remain optional in old UI consumers. Intentional null hiding uses `rollback 1 hides orders where fee = null because 'An unquoted fee must not look free.'` in candidate source. The writer permits only those null rows and their actual hidden-reference dependents. Widened nonnull values still stay visible. Removed defaulted fields require truthful `down` expressions; previews suggest cross-table candidates for moved values, never silently show a misleading old default. Snapshot previews do not freeze later writes: activation revalidates under its writer transaction.
+Deploy prepares compiled rollback views when a predecessor cannot hold newly allowed values. An implementation repair behind unchanged data/intent declarations also prepares a view. A new column write audience alone does not; exact historical writes must preserve its rule or selection refuses with the operation and column. These views retain the complete authored current schema, helpers, programs and policy while admitting old names and inputs; unsupported mappings require authored compatible guarded source. Old inputs may fit wider same-format text/list bounds or omit new optional arguments. Incompatible old write exports pause with E_OP; required queries need a compatible endpoint. Removed data-bearing inputs need a consuming compatibility endpoint, never deprecated-and-discarded inputs. `rollback --to 1` selects release 1's registered view in the active deployment's context, retaining current guards and widened domains; each move prints a stdout `live:` line naming the selected source or registered view. A view retains current guards; its operation surface can be the guarded old workflow or the complete current workflow. Inspect its immutable source and preview checklist before depending on an old write. The original source remains immutable. After upgrading the CLI/runtime, restart an older running serve before switching releases; an older host refuses the new custody control feature before admission. `--exact` deliberately selects that source and reports its dormant population. Newer views never become ordinary latest. If a guard cannot be transported safely or a view cannot compile, deploy refuses until source supplies a compatible workflow. Nullable old results remain a client compatibility change: render an amount still to follow as pending, never zero. Optional media must remain optional in old UI consumers. Intentional null hiding uses `rollback 1 hides orders where fee = null because 'An unquoted fee must not look free.'` in candidate source. The writer permits only those null rows and their actual hidden-reference dependents. Widened nonnull values still stay visible. Removed defaulted fields require truthful `down` expressions; previews suggest cross-table candidates for moved values, never silently show a misleading old default. Snapshot previews do not freeze later writes: activation revalidates under its writer transaction.
 
 ## Bridge a safety gate before exact rollback (SQLite)
 Use this beside the enum-widening rollback recipe above. Suppose v2 added `grounding.state = 'inspection'`; v1 holds only `'clear'`/`'hold'`. Selecting exact v1 hides that row and its children, so v1's `book` guard may allow a booking that v2 blocks. Counts and sample ids are snapshot dependencies, not predicate matches; later writes can change the plan.
 
-1. Start from the old UI/operations, but keep v2's widened `grounding.state` domain, safety table, read audience and booking `require`. Save this complete source as `versions/bridge/schema.q` and deploy it with `deploy ./deployment --schema versions/bridge/schema.q --check`, then without `--check`.
-2. While the gate still runs, migrate each inspection to a truthful old-domain hold through an authorized bridge mutation. Do not relabel it clear just to satisfy v1. Keep linked metadata until its parent can be safely represented; if v1 cannot invalidate newer metadata, keep that behavior in the bridge too.
-3. Prove the same booking/payment still refuses for the blocked case and that the named lists/counts preserve the intended business denominator. Re-run the final old-source preview against the repaired live population.
-4. Select v1 only when those checks pass. If the old source cannot preserve the invariant, keep the bridge or pause that workflow. Retained storage cannot supply absent logic.
+1. Start from the old UI/operations, but keep v2's widened `grounding.state` domain, safety table, read audience and booking `require`. Save this complete source as `versions/bridge/schema.q` and deploy it with `deploy ./deployment --schema versions/bridge/schema.q --check`, then without `--check`. 2. While the gate still runs, migrate each inspection to a truthful old-domain hold through an authorized bridge mutation. Do not relabel it clear just to satisfy v1. Keep linked metadata until its parent can be safely represented; if v1 cannot invalidate newer metadata, keep that behavior in the bridge too. 3. Prove the same booking/payment still refuses for the blocked case and that the named lists/counts preserve the intended business denominator. Re-run the final old-source preview against the repaired live population. 4. Select v1 only when those checks pass. If the old source cannot preserve the invariant, keep the bridge or pause that workflow. Retained storage cannot supply absent logic.
 
 ## What the old release sees (SQLite)
 | Request after rollback | Result |
@@ -149,9 +148,7 @@ Use this beside the enum-widening rollback recipe above. Suppose v2 added `groun
 These dormant-row outcomes require `rollback <deployment> --to 1 --exact`. A registered default view keeps widened old-table rows visible with the current guard. Ordinary renames, required-field additions and splits with a fitting down do not require a view merely because the app declares an invariant. A needed view uses the current workflow or a compatible loosened bridge with current guards. A guarded current view names removed nullable fields as absent results and removed writes as E_OP; author a compatible current endpoint to keep an old write available. On a pre-0.4.39 store, a refusal names `rollback <deployment> --to N --exact` and "redeploy with 0.4.39 to register a view"; preview exact selection with --check before accepting its historical behavior. Absent operations still return E_OP. Test audiences and guards with real accounts. Rollback previews lead with records hidden from tables the target release has, then empty/defaulted legacy cells and newer-only table rows. Counts precede read rules; they do not infer birth release or a viewer’s query result. Declare a reverse projection for a truthful old representation, or keep a bridge. Guard/refusal and query/count/safety diffs follow. Verify filtered/paged/per-viewer results and denominators. Literal-default backfills print `table.column ← value on N rows` in previews and cold/hot deploy receipts: interpreted historical fields, not physical writes. Preview shows old and new rule clauses and mutation `require`s side by side, preserving Boolean parentheses. A proved tightening is a note, including `require A else X` becoming `require A else X; require B else Y` when A's refusal contract is unchanged; changed codes/messages still warn. A loosening or unproved implication is a WARNING, including rollback that removes a new guard. Unchanged clauses and consulted keys, fields, rules, auth and visibility are silent. Unread column domains and forward domain widening do not unprove a probe; narrowing still gets exact dormant-value/population warnings. Changed dependencies group once: verify refusal cases. Comparison never changes admission. Missing operations/schedules, populated removed tables, changed clauses and job bodies are named separately. An unchanged job compiling differently after a dependency change gets a note. Predicate-only read-through changes preserve bound captures and parent lifetimes; structural capture changes and new uncaptured rows still need safe audience correspondence. Receipts and previews count storage by kind: `1 row, 2 cells, 0 index entries dormant`. Dormant rows cover their retained cells; standalone cell counts/samples belong only to active rows. Bytes/assets follow the same disjoint ownership. Samples are labelled and unique within each kind/path, for example `rows notes [A]; cells notes.color [B, C]`. A retained index definition represents logical entries to rebuild, not a dormant physical index. A widening note describes values later writes could use; a compatibility WARNING counts only current values the selected release cannot hold. Compatible forward has no such warning.
 
 ## Clients across rollback (SQLite)
-Save versions/v1/schema.q (and any other .q modules with their original names) outside snapback/ and create `snapback/client-compatibility.json` containing `{"baseline":"versions/v1","since_release":2}`. `check`/`dev` emit added row/result fields as optional, labelled "Since release 2", retaining older result value domains. Required operation parameters remain required; only declared optional, defaulted or deprecated arguments may be omitted. Baseline generation warns about real old-client input breaks and changed/removed result domains; a declared table rename preserves reference input identity, and purely additive result fields print a RESULT NOTE. This is your release label, not server generation; ordinary types stay required without opt-in. Use `row.color ?? "none"` for the baseline fallback. Keep contemporary fixtures in versions/v1/fixtures/; deploy with `--schema versions/v1` and test with `--source versions/v1` (guide testing). Baselines resolve from the original project root, including saved-source deploys.
-
-`useRelease()` from snapback4/react follows the authenticated catalog even when query gates are closed: loading, denied, or `{generation, operations, tables}` with public argument/field shapes. Generated `api.op.available(release)` is false while unready or when name/kind/existing-argument signatures differ or the server adds a required argument; extra optional served parameters are compatible. This checks capability, not authorization or unchanged business semantics; still handle E_OP/E_INPUT and authored guard refusals when a switch races it. The SDK withdraws old metadata on observed generations, polls while subscribed, and returns loading offline/on catalog failure; account retirement/close withdraws it. Keep draft state above generation-sensitive read/action gates; remount only the gated children. Dormant means unavailable on this release, not deleted. Test v2 → v1 → v2 with one frontend: field fallbacks, missing operations, retained drafts and restored values. Alternatively check selected immutable source in a separate copy and rebuild its matching frontend. Preserve deployment source; Expo/Exact runtime changes also require a device rebuild.
+Save versions/v1/schema.q (and any other .q modules with their original names) outside snapback/ and create `snapback/client-compatibility.json` containing `{"baseline":"versions/v1","since_release":2}`. `check`/`dev` emit added row/result fields as optional, labelled "Since release 2", retaining older result value domains. Required operation parameters remain required; only declared optional, defaulted or deprecated arguments may be omitted. Baseline generation warns about real old-client input breaks and changed/removed result domains; a declared table rename preserves reference input identity, and purely additive result fields print a RESULT NOTE. This is your release label, not server generation; ordinary types stay required without opt-in. Use `row.color ?? "none"` for the baseline fallback. Keep contemporary fixtures in versions/v1/fixtures/; deploy with `--schema versions/v1` and test with `--source versions/v1` (guide testing). Baselines resolve from the original project root, including saved-source deploys. `useRelease()` from snapback4/react follows the authenticated catalog even when query gates are closed: loading, denied, or `{generation, operations, tables}` with public argument/field shapes. Generated `api.op.available(release)` is false while unready or when name/kind/existing-argument signatures differ or the server adds a required argument; extra optional served parameters are compatible. This checks capability, not authorization or unchanged business semantics; still handle E_OP/E_INPUT and authored guard refusals when a switch races it. The SDK withdraws old metadata on observed generations, polls while subscribed, and returns loading offline/on catalog failure; account retirement/close withdraws it. Keep draft state above generation-sensitive read/action gates; remount only the gated children. Dormant means unavailable on this release, not deleted. Test v2 → v1 → v2 with one frontend: field fallbacks, missing operations, retained drafts and restored values. Alternatively check selected immutable source in a separate copy and rebuild its matching frontend. Preserve deployment source; Expo/Exact runtime changes also require a device rebuild.
 
 ## Trigger a deployed job (SQLite)
 A running serve accepts `POST /jobs/<job>` with a full service token; the job executes as the system on its FIFO queue and server clock. Every full service seat can trigger system jobs, so provision these tokens only to trusted operators. Guest/account sessions, read-scoped tokens and personas cannot use this door. `POST /dev/jobs/<job>` remains development-only.
@@ -161,13 +158,14 @@ bunx snapback4 run reconcile --release ./deployment --json
 unset SNAPBACK4_SERVICE_TOKEN
 ```
 `--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. Starter/client recipes: `guide client`.
-
 Real-account production and its durable role/restart/rollback proof: `guide production`.
 
 ## Inspection, proxies and TLS (SQLite)
 
 `data TABLE --release ./deployment --json` returns `{rows, more, limit}`. The default limit is 50; `more:true` means the snapshot was truncated. Increase `--limit N` to inspect more; `--limit 0` returns no rows and reports whether any exist. Non-JSON output remains one row per line. `snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct booleans and schema-proven media columns decoded to ordinary wire JSON. Positional `--json` retains tagged media text. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. A truncated JSON query reports its repair on stderr without corrupting stdout. Default `sql`, `data` and `releases` output also reports a nonzero dormant-row count on stderr; a missing active table names its retained rows and the concrete dormant query. `sql --dormant --release ./deployment` shows retained rows/cells, including removed tables; `sql --all-releases --release ./deployment` adds active images. `_snapback_state`, `_snapback_source` and `_snapback_columns` identify provenance and provided cells; these are retained images, not historical snapshots. Both modes are read-only; internal tables remain unavailable. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. `--json-objects` returns `{header, columns, rows, limit, more, ruleFiltered:false}` with object `rows`; `--json` uses positional `rows`. Put flags outside the quoted SQL. N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. It groups root blockers with their dependents; persona-only schemas get one identity note. Add a service-seat insert mutation and provision real account relationships. E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.
 
+The default day-two proof hook returns explicit field changes for v1 writes. For a deliberate deletion return `{id:"table/id",fields:[],deleted:true}`: the row must be visible before the v1 callback, absent after it and stay absent on forward. Other persisted ids and values remain checked.
+
 ## Capture a saved version (SQLite)
 After check and business cases pass, from the app root:
 ```sh
@@ -175,41 +173,35 @@ snapback4 deploy ./deployment --save-version versions/v1
 snapback4 rollback ./deployment --to 1 --check --bridge ./bridge
 snapback4 deploy ./deployment --schema ./bridge --restore-dormant --check
 ```
-The new versions/v1 captures selected modules, their contemporary fixtures, an importable `versions/v1/generated/api.ts` plus its package marker, and `versions/v1/release.json` with the actual immutable release id, source hash and CLI version. An unchanged deploy keeps its id and may refresh those derived generated/label artifacts only when the saved directory's complete Quarry source set and bytes exactly match the selected source; source and fixture evidence stay intact, and differing source refuses. Choose a new positive-numbered versions/vN for changed source; saving cannot combine with --check. Saved-source deploy uses its own fixtures and emits the saved source's API rather than the working tree's API. Use the recorded id when choosing a baseline; since_release remains the author-supplied newer-schema label. The bridge starts from complete target Quarry operations with compatible value domains loosened to include current data, retaining new tables with their current rules, plus this app's `bridge/ROLLBACK-CHECKLIST.md`. Retain current domains, audiences, guards and quotas; repair records through authorized mutations; prove blocked cases refuse and affected lists/counts remain correct; repeat the old-source preview. No bridge is activated or business migration synthesized. JSON includes checklist; --verbose retains full evidence/index paths. Dormant rows reserve ids but no unique slots: new active rows may block restoration. A widened non-unique bridge permits repair before reinstating uniqueness; retained storage cannot supply absent safety logic.
+The new versions/v1 captures selected modules, their contemporary fixtures, an importable `versions/v1/generated/api.ts` plus its package marker, and `versions/v1/release.json` with the actual immutable release id, source hash and CLI version. An unchanged deploy keeps its id and may refresh those derived generated/label artifacts only when the saved directory's complete Quarry source set and bytes exactly match the selected source; source and fixture evidence stay intact, and differing source refuses. Choose a new positive-numbered versions/vN for changed source; saving cannot combine with --check. Saved-source deploy uses its own fixtures and emits the saved source's API rather than the working tree's API. Use the recorded id when choosing a baseline; since_release remains the author-supplied newer-schema label. The bridge prefers the complete current guarded workflow, retaining new tables and current rules; this app's `bridge/ROLLBACK-CHECKLIST.md` names old-client domain/input and safety-clause repairs. Retain current domains, audiences, guards and quotas; repair records through authorized mutations; prove blocked cases refuse and affected lists/counts remain correct; repeat the old-source preview. No bridge is activated or business migration synthesized. JSON includes checklist; --verbose retains full evidence/index paths. Dormant rows reserve ids but no unique slots: new active rows may block restoration. A widened non-unique bridge permits repair before reinstating uniqueness; retained storage cannot supply absent safety logic.
 
 Hot deploy and rollback require the running `serve` host to support this CLI's activation protocol, including `--exact` selection of original source. If `E_RELEASE_RUNTIME` says the host predates release custody, restart `serve` with this CLI and repeat the command; the mixed-version request refuses before activation.
 
 ## Keep v1 clients working (SQLite)
 
-`deploy --check --json` reports `clientCompatibility` separately from data adoption: missing operations, changed kinds, required new arguments, removed or narrowed inputs, result shape/value changes and changed refusal codes/messages. Deploy prints the same warnings. Input breaks name the old release and the E_INPUT/E_OP outcome. A result or behavior review asks you to verify the intended contract; a correct new privacy denial is intentional behavior, not an input shape failure. The comparison is conservative, not a proof of unchanged logic. For example, save this v1 source and its callers sending `{name:"Ada",obsolete:"old input"}` to `greet`:
-
+Keep old callable names with operation aliases and old argument spellings with argument aliases; supply literal defaults only for real default choices. Preserve data-bearing inputs with a compatibility endpoint that consumes them. Use `deprecated` only for deliberately discarded, non-data-bearing input; it forbids body references. Aliases stay within a module and cannot chain. See `guide evolution` for schema adoption and `guide rename` for a packed, persistent two-cycle example.
+Here `obsolete` is already unused in v1 and carries no data. The second source preserves its callers while adding a real literal default:
 ```quarry
 use identity guests
 query greet(name: text <=40, obsolete: text <=40):
   return {message: name + '!'}
 ```
-Deploy this v2 source. The unchanged v1 call still returns `{message:"Ada!"}`; new callers can use `greeting` and omit `suffix` and `obsolete`:
-
 ```quarry
 use identity guests
 query greeting(displayName: text <=40 alias name, suffix: text <=1 default '!', obsolete: text <=40 deprecated):
   return {message: displayName + suffix}
 alias greet = greeting
 ```
-`alias name` maps the old argument to `displayName`; supply either spelling, never both. Use the alias for renames; `deprecated` deliberately discards its value. A literal default handles omitted or null arguments and must fit the declared scalar type; explicit non-null input still validates. `deprecated` accepts a validated optional argument but forbids referring to it in the body. Unknown arguments still refuse. These modifiers apply to non-native Quarry queries and mutations; helpers, actions and jobs keep their distinct invocation contracts. Aliases target an authored query/mutation in the same module, carry the same rules/guards/results, and cannot chain. Retain the old endpoint until its callers have retired; preserve the old result projection and handle intended denials.
-
 Deploy registers a compiled visible view for widened domains and relaxed unique keys, or refuses unsupported adaptation. It also reports remaining reverse-projection risks: dropping a required old column or widening a value domain can strand newly written rows. The preflight separately attempts exact reverse adoption on its post-deploy snapshot, naming present-data failures. Keep old fields and compatible domains in an expand/contract bridge; after writes run the named `rollback <deployment> --to N --check --bridge <new-dir>` before selecting N. A green snapshot never freezes later writes.
 
 ## Persistent production: SQLite v1 → v2 → rollback → forward
 
-Replacement transforms read reversible preimages; input types cover original/native rows. `down table name(typedInputs): {oldField: expression}` declares a reversible old view for newer rows; exact old preimages win, conflicting projected-cell edits refuse forward. Native preimages and old-view outputs must be authoritative scalars; use separate scalar columns instead of replacing a reference, asset, collection or lifetime field. Reference inputs retain their parent lifetimes across older views; deleted/reused parents refuse forward. Unrepresentable values stay dormant. `newField: Type renamed from oldField` carries a scalar cell both ways; asset columns and asset lists move their actual cell and single home together. Reference renames require identical target/type/on-delete semantics and retain lifetime evidence; engine-owned moves refuse before activation; keep old operation/result wrappers where clients need them.
-
+Replacement transforms read reversible preimages; input types cover original/native rows. `down table name(typedInputs): {oldField: expression}` declares a reversible old view for newer rows; exact old preimages win, conflicting projected-cell edits refuse forward. Native preimages and old-view outputs must be authoritative scalars; use separate scalar columns instead of replacing a reference, asset, collection or lifetime field. Reference inputs retain their parent lifetimes across older views; deleted/reused parents refuse forward. Unrepresentable values stay dormant. `newField: Type renamed from oldField` carries a scalar cell both ways; asset columns and asset lists move their actual cell and single home together. Reference renames require identical target/type and preserve their reference lifetime; the selected release supplies its on-delete policy and retain lifetime evidence; engine-owned moves refuse before activation; keep old operation/result wrappers where clients need them.
 A table declares `table observations renamed from behaviors:` to preserve its row/reference identity and old-release writes; it refuses merging independent table histories. Ordinary backfill expressions may read indexed cross-table `exists` or unique points against one pre-patch snapshot. The language-card example uses migration-only `fileText(file)` with `nonemptyLines(text)` for repeated nonempty UTF-8 entries; unavailable bytes, invalid UTF-8 or a job-meter cut refuse atomically. It never supplies ordinary mutation-time file validation. Active writes refresh accepted backfill inputs; older-release edits still need recomputation agreement or conflict repair. An absent optional rename destination is not a conflict.
 
-Computed `down` cannot replace files/images, asset lists, references or a missing table. Required → optional media, an album becoming empty, or nullable money needs a generated loosened-target bridge when no truthful scalar substitution exists. Review target operations reading loosened columns and nullable UI assumptions. Keep current safety guards absent from the target; retaining new tables does not make them visible through frozen old operations. Automatic registered views handle compatible widenings. For an authored bridge, deploy it as a new release with `--restore-dormant`, first with `--check`.
+Computed `down` cannot replace files/images, asset lists, references or a missing table. Required → optional media, an album becoming empty, or nullable money needs a generated compatible repair source when no truthful scalar substitution exists. Review old-client operations, nullable UI assumptions and every current safety guard; retaining new tables does not make them visible through frozen old operations. Automatic registered views handle compatible widenings. For an authored bridge, deploy it as a new release with `--restore-dormant`, first with `--check`.
 
 Save this script and run it with Node. `PRODUCTION_DIR` selects its persistent store; reruns preserve rows/users. It proves backfill, privacy and rollback/forward behavior. This example widens the stored weight domain, so deploy registers a view. Default rollback preserves current privacy through that view; `--exact` deliberately restores v1's broader reads after an explicit review. REL5 owns reactivation/old-client reporting; SEC3 owns privacy/audit.
-
 ```js
 // day-two-production.mjs — this exact fence runs against the packed package.
 import assert from "node:assert/strict";
@@ -326,7 +318,8 @@ try {
   console.log(JSON.stringify({status:"passed", persistent:true, before:before.size, after:changed.size, backfill:"car → commercial after v1 edit", privacy:"v1 broad → v2 private → default private → exact v1 broad → v2 private"}));
 } finally { await host.stop(); }
 ```
-Storage, users and rows survive. Resolve reported conflicts through a truthful bridge.
-Deploy and deploy --check lead with a verdict and test status. Changed-scope security review is last, followed by a repeated verdict; full JSON retains all findings. Ordinary check policy belongs to SEC7. The recorded test result includes its age; stale or missing evidence is explicit. Without a matching completed campaign they demand `snapback4 test` for the selected source and fixtures (saved-source previews name `test --source`). Add `--strict` to refuse reachable refuted intent before activation; unproved intent and no-invariant notes remain advisory. A finite campaign is evidence, not proof. See `guide security` for the independent-intent loop.
+Storage, users and rows survive. Resolve reported conflicts through a truthful bridge. Deploy and deploy --check lead with a verdict and test status. Changed-scope security review is last, followed by a repeated verdict; full JSON retains all findings. Ordinary check policy belongs to SEC7. The recorded test result includes its age; stale or missing evidence is explicit. Without a matching completed campaign they demand `snapback4 test` for the selected source and fixtures (saved-source previews name `test --source`). Add `--strict` to refuse reachable refuted intent before activation; unproved intent and no-invariant notes remain advisory. A finite campaign is evidence, not proof. See `guide security` for the independent-intent loop.
 
 Migration warnings require a recorded older version crossing the behavior's introduction. Fresh init/check stays quiet; stderr delivery acknowledges the installed version, including CI. Paths cover session literals, advance arithmetic, persistent startDev and data --json. Future known-family store formats refuse with “a newer Snapback (FORMAT)”; upgrade the CLI. SQL inspection also exits nonzero.
+
+`check --store ./deployment/store.sqlite` compiles required rollback views against that deployment without registering them. A configured client baseline is checked too. Source-only check cannot qualify a production transition without a predecessor. New UI starters include `day2:proof`: snapshots compare by id over two cycles, retain v2-native rows, and exclude values deliberately changed by v1-client writes from equal-value comparisons. Add authenticated business/refusal assertions in its hook; the default proves storage conservation only.
diff --git a/snapback4/crates/snapback4/src/serve_readers.rs b/snapback4/crates/snapback4/src/serve_readers.rs
index 81765ede3d..6283972dba 100644
--- a/snapback4/crates/snapback4/src/serve_readers.rs
+++ b/snapback4/crates/snapback4/src/serve_readers.rs
@@ -97,7 +97,7 @@ impl QueryReaders {
     }
     // Startup has no global mutex yet. PG serve readiness includes all 30
     // detached loans, including their identity/generation qualification.
-    pub(super) fn prepare(&mut self, engine: &Engine) -> Result<(), RuntimeError> {
+    pub(super) fn prepare_population(&mut self, engine: &Engine) -> Result<(), RuntimeError> {
         #[cfg(feature = "postgres")]
         if matches!(engine.store(), snapback4_core::store_port::AnyStore::Postgres(_)) {
             let source = self.source.as_ref().ok_or_else(|| RuntimeError::Store("Postgres reader population unavailable before readiness".into()))?;
