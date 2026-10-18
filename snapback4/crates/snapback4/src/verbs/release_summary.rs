//! Human preview groups facts about one affected table/operation once.
// @ref LLP 3000.000.000#15-wave-15-preview-and-rollback-day5 — full evidence remains available in JSON and verbose output.
use std::collections::{BTreeMap, BTreeSet};
use snapback4_core::{Schema, ir::Program, store::DormantItem, successor::Step};
struct Group { warnings: Vec<String>, notes: Vec<String>, priority: u8 }
impl Default for Group { fn default() -> Self {Self {warnings:Vec::new(),notes:Vec::new(),priority:2}} }
fn table_prefix(text: &str, tables: &BTreeSet<String>) -> Option<String> {
    tables.iter().filter(|name|text.strip_prefix(name.as_str()).is_some_and(|tail|tail.is_empty() || tail.starts_with(['.',':',' ']))).max_by_key(|name|name.len()).cloned()
}
fn subject(text: &str, tables: &BTreeSet<String>, programs: &BTreeMap<String,Program>) -> String {
    // Read only generated subject positions, never arbitrary words inside an
    // authored predicate/refusal/value. Unknown formats remain release facts.
    if let Some(table)=table_prefix(text,tables) {return table;}
    for marker in ["table ","dependent ","backfill: "] {
        if let Some(tail)=text.strip_prefix(marker) && let Some(table)=table_prefix(tail,tables) {return table;}
    }
    let prefix=text.split(';').next().unwrap_or(text);
    if text.starts_with("queries/counts ") && let Some((_,tail))=prefix.split_once(" read ") && let Some(table)=table_prefix(tail,tables) {return table;}
    if text.starts_with("release ") && let Some((_,tail))=prefix.split_once(" safety dependencies on ") && let Some(table)=table_prefix(tail,tables) {return table;}
    if text.starts_with("rollback users get release ") {
        if let Some((_,tail))=prefix.split_once(" quotas on ") && let Some(table)=table_prefix(tail,tables) {return table;}
        if let Some((_,tail))=prefix.split_once("'s ") && let Some(table)=table_prefix(tail,tables) {return table;}
    }
    if text.starts_with("release ") {
        if let Some(token)=prefix.split_whitespace().last() && let Some((owner,effect))=token.rsplit_once('.') {
            if effect=="require" {return format!("operation {owner}");}
            if tables.contains(owner) && matches!(effect,"read"|"insert"|"update"|"delete") {return owner.into();}
        }
        for name in programs.keys() {
            if prefix.ends_with(&format!(" operation {name}")) {return format!("operation {name}");}
        }
    }
    "release behavior".into()
}
fn brief(text: &str) -> String {
    // Semicolons also separate authored guards and multiple cap declarations;
    // retaining the full fact avoids dropping their contracts or caveats.
    text.to_owned()
}
pub(super) fn print(current: Option<&Schema>, target: &Schema, programs: &BTreeMap<String,Program>, warnings: &[String], notes: &[String], steps: &[Step], items: &[DormantItem]) {
    let tables: BTreeSet<_>=target.tables.keys().chain(current.into_iter().flat_map(|s|s.tables.keys())).cloned().collect();
    let mut groups=BTreeMap::<String,Group>::new();
    for (warning, lines) in [(true,warnings),(false,notes)] {
        for line in lines {
            let group=groups.entry(subject(line,&tables,programs)).or_default();
            let priority=if line.contains("safety guard") || line.contains(".require;") {0} else if line.contains("confidentiality") || line.contains("safety rule") {1} else {2};
            group.priority=group.priority.min(priority);
            let text=if priority==0 {line.clone()} else {brief(line)};
            let dest=if warning {&mut group.warnings} else {&mut group.notes};
            if !dest.contains(&text) {dest.push(text);}
        }
    }
    for step in steps {
        let path=step.path.strip_prefix("tables.").unwrap_or(&step.path);
        let key=table_prefix(path,&tables).unwrap_or_else(||path.to_owned());
        if path.strip_prefix(&key).is_some_and(|tail|tail.starts_with(".indexes.")) {continue;}
        let group=groups.entry(key).or_default();
        // Keep each user-visible source change even when another fact already
        // names this table. Only index plumbing is verbose-only.
        let detail=brief(&format!("{}: {}",path.replace(".columns.","."),step.message));
        if !group.notes.contains(&detail) {group.notes.push(detail);}
    }
    let mut storage=BTreeMap::<String,[u64;3]>::new();
    for item in items.iter().filter(|item|item.rows>0) {
        let name=table_prefix(&item.path,&tables).unwrap_or_else(||item.path.clone());
        let slot=match item.kind.as_str() {"column"=>1,"index"=>2,_=>0};
        storage.entry(name).or_default()[slot]+=item.rows;
    }
    for (name,[rows,cells,indexes]) in storage {
        groups.entry(name).or_default().notes.push(format!("retained: {rows} dormant rows, {cells} cells, {indexes} index entries"));
    }
    let mut groups=groups.into_iter().collect::<Vec<_>>();
    groups.sort_by_key(|(name,g)|(g.priority,name.clone()));
    for (name,mut group) in groups {
        let warning=!group.warnings.is_empty();
        group.warnings.append(&mut group.notes);
        println!("  {} {name}: {}{}",if warning {"WARNING"} else {"note:"},group.warnings.join("; "),if warning {"; verify these cases or preserve the current behavior in a bridge release"} else {""});
    }
}

#[test]
fn authored_values_cannot_assign_a_guard_to_an_unrelated_table() {
    let tables=BTreeSet::from(["unrelated".to_owned(),"workspace.plans".to_owned()]);
    let line="release 1 loosens book.require; old: require title != 'unrelated' else STOP; new: allow; rollback users lose a current safety guard";
    assert_eq!(subject(line,&tables,&BTreeMap::new()),"operation book");
    assert_eq!(subject("workspace.plans.state: 2 rows become dormant",&tables,&BTreeMap::new()),"workspace.plans");
}
