//! Immutable default rollback views, authorized by a committed parent deploy.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — registration shares the deployment's commit boundary.
use super::Project;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(super) struct View {
    pub target: u64,
    pub release: u64,
    pub parent: u64,
    pub digest: String,
    pub changes: Vec<String>,
    pub hides: Vec<String>,
}
pub(super) fn is_view(dir: &Path, n: u64) -> bool {
    dir.join("releases")
        .join(n.to_string())
        .join("rollback-view.json")
        .is_file()
}
pub(super) fn metadata(root: &Path) -> Result<Option<View>, String> {
    match fs::read(root.join("rollback-view.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub(super) fn manifest(root: &Path) -> Result<Vec<View>, String> {
    match fs::read(root.join("rollback-views.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}
pub(super) fn resolve(dir:&Path,target:u64)->Result<Option<View>,String>{
    let store=snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).map_err(|e|e.to_string())?;
    let Some(active)=store.release_value().map_err(|e|e.to_string())?.map(|s|s.parse::<u64>().map_err(|e|e.to_string())).transpose()?else{return Ok(None)};
    drop(store);
    let root=dir.join("releases").join(active.to_string());
    let context=if let Some(view)=metadata(&root)?{verify(dir,&view)?;view.parent}else{active};
    super::releases::selectable(dir,context)?;
    let view=manifest(&dir.join("releases").join(context.to_string()))?.into_iter().find(|v|v.target==target);
    if let Some(view)=&view{verify(dir,view)?;}Ok(view)
}
pub(super) fn verify(dir: &Path, view: &View) -> Result<(), String> {
    if view.parent == view.release || is_view(dir, view.parent) {
        return Err("invalid rollback view parent".into());
    }
    super::releases::selectable(dir, view.parent)?;
    let parent = dir.join("releases").join(view.parent.to_string());
    if !manifest(&parent)?.iter().any(|v| v == view) {
        return Err("rollback view is not registered by its committed parent".into());
    }
    let root = dir.join("releases").join(view.release.to_string());
    if metadata(&root)?.as_ref()!=Some(view){return Err("rollback view metadata differs from its committed manifest".into())}
    if crate::release_files::executable_digest(&root)? != view.digest {
        return Err("rollback view source digest changed".into());
    }
    Ok(())
}
pub(super) fn prepare(
    dir: &Path,
    stage: &Path,
    bound: &snapback4_lang::Bound,
    parent: u64,
) -> Result<Vec<View>, String> {
    let current = Project { root: stage.into() }
        .sources()
        .map_err(|e| e.to_string())?;
    let mut views = Vec::new();
    let mut id = parent;
    for target in super::releases::ordinary_releases(dir)? {
        let old_root = dir.join("releases").join(target.to_string());
        let old = super::releases::bound_at(old_root.clone())?;
        let original=Project{root:old_root.clone()}.sources().map_err(|e|e.to_string())?;
        let risks = super::rollback_foresight::risks(&bound.schema, &old.schema, target, dir);
        let widening=snapback4_lang::release_bridge::requires_view(&original,&current);
        let defaulting=super::rollback_foresight::missing_defaults(&bound.schema,&old.schema)?;
        if !defaulting.is_empty(){return Err(format!("E_ADOPT: rollback to release {target} would misrepresent a removed defaulted column {}; declare a truthful cross-table down before deploy: {}",defaulting.join(", "),risks.join("; ")))}
        if !widening {
            continue;
        }
        if crate::dev_worker::source(&Project {
            root: old_root.clone(),
        })
        .is_some()
            || !crate::dev_worker::declared(&Project {
                root: old_root.clone(),
            })?
            .is_empty()
        {
            return Err("E_ADOPT: a generated rollback view needs an authored worker bundle; retain a compatible guarded source".into());
        }
        let hides = bound
            .rollback_hides
            .iter()
            .filter(|h| h.release == target)
            .collect::<Vec<_>>();
        let mut source = current.clone();
        // A typed null acknowledgment retains this one old nonnullable domain;
        // all other widened columns still receive the visible bridge union.
        for hide in &hides {
            let old_kind = old
                .schema
                .table(&hide.table)
                .and_then(|t| t.columns.get(&hide.column))
                .ok_or("rollback hides names no predecessor column")?;
            if bound.schema.table_renames.contains_key(&hide.table)
                || bound
                    .schema
                    .asset_renames
                    .get(&hide.table)
                    .is_some_and(|m| m.contains_key(&hide.column))
            {
                return Err("rollback hides requires the same table/column spelling in the original release".into());
            }
            if old_kind.is_optional() {
                return Err("rollback hides requires a nonnullable predecessor column".into());
            }
            for (file, text) in &mut source {
                let doc = snapback4_lang::parse_document(file, text).0;
                if let Some(column) = doc
                    .tables
                    .iter()
                    .find(|t| t.name == hide.table)
                    .and_then(|t| t.columns.iter().find(|c| c.name == hide.column))
                {
                    if let Some((start, end)) =
                        snapback4_lang::release_bridge::type_span(file, text, column)
                    {
                        let scalar = column.type_.required();
                        text.replace_range(
                            start..end,
                            &snapback4_lang::print::scalar_type(&scalar),
                        );
                    }
                }
            }
        }
        let bridge = snapback4_lang::release_bridge::loosen(
            &original,
            &source,
        );
        if !bridge.diagnostics.is_empty() {
            return Err(format!(
                "E_ADOPT: rollback view for release {target} does not compile; retain a truthful guarded old workflow or declare its intentional hiding: {}",
                bridge
                    .diagnostics
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; ")
            ));
        }
        let compiled = snapback4_lang::compile(&bridge.sources);
        let mut aliases:std::collections::BTreeMap<String,String> = bound
            .schema
            .table_renames
            .iter()
            .filter(|(_, old)| compiled.schema.tables.contains_key(*old))
            .map(|(new, old)| (new.clone(), old.clone()))
            .collect();
        for(new,prior)in &compiled.schema.table_renames{if bound.schema.tables.contains_key(prior)&&!bound.schema.tables.contains_key(new){aliases.insert(prior.clone(),new.clone());}}
        let current = bound
            .schema
            .with_table_names(&aliases)
            .map_err(|e| e.to_string())?;
        let mut columns=std::collections::BTreeMap::new();
        for(name,table)in &compiled.schema.tables{if let Some(next)=current.table(name){
            let mut map=std::collections::BTreeMap::new();
            for(new,prior)in current.asset_renames.get(name).into_iter().flatten(){if next.columns.contains_key(new)&&table.columns.contains_key(prior)&&!table.columns.contains_key(new){map.insert(new.clone(),prior.clone());}}
            for(new,prior)in compiled.schema.asset_renames.get(name).into_iter().flatten(){if next.columns.contains_key(prior)&&table.columns.contains_key(new)&&!next.columns.contains_key(new){map.insert(prior.clone(),new.clone());}}
            if !map.is_empty(){columns.insert(name.clone(),map);}
        }}
        let current=current.with_column_names(&columns);
        for (name, table) in &compiled.schema.tables {
            if let Some(next) = current.table(name) {
                use snapback4_core::schema::Constraint;
                let hard=|c:&Constraint|!matches!(c,Constraint::Text{..}|Constraint::Unique{..}|Constraint::Capabilities(_)|Constraint::Recorded);
                let column=|field:&String|field.clone();
                for c in next.constraints.iter().filter(|c|hard(c)) {
                    let mut constraint=c.clone();
                    match &mut constraint {Constraint::Cap{by,..}|Constraint::Immutable{fields:by}=>for f in by{*f=column(f)},_=>()}
                    if !table.constraints.contains(&constraint){return Err(format!("E_ADOPT: rollback view for release {target} cannot preserve current constraint on {name}; author a compatible guarded rollback workflow"))}
                }
                for index in next.indexes.values().filter(|i|i.unique){
                    let mut components=index.components.clone();for part in &mut components{if let snapback4_core::schema::IndexComponent::Column(c)=part{*c=column(c);}}
                    if !table.indexes.values().any(|i|i.unique&&i.components==components){return Err(format!("E_ADOPT: rollback view for release {target} cannot preserve a current unique key on {name}; author a compatible guarded rollback workflow"))}
                }
                let on_delete=next.on_delete.iter().map(|(field,policy)|(column(field),policy.clone())).collect::<std::collections::BTreeMap<_,_>>();
                if table.expire!=next.expire||table.not_before!=next.not_before||table.through!=next.through||table.on_delete!=on_delete||table.sync!=next.sync||table.leave!=next.leave {
                    return Err(format!("E_ADOPT: rollback view for release {target} cannot preserve current lifetime or sync audience on {name}; author a compatible guarded rollback workflow"))
                }
                if ![
                    (&table.rules.read, &next.rules.read),
                    (&table.rules.insert, &next.rules.insert),
                    (&table.rules.update, &next.rules.update),
                    (&table.rules.delete, &next.rules.delete),
                ]
                .iter()
                .all(|(view, current)| view == current)
                    || table.columns.keys().any(|c| {
                        table.column_reads.get(c) != next.column_reads.get(c)
                            || table.written_by.get(c) != next.written_by.get(c)
                    })
                {
                    return Err(format!(
                        "E_ADOPT: rollback view for release {target} cannot preserve current authority on {name}; retain an authored compatible guarded old workflow before deploying this widening"
                    ));
                }
            }
        }
        if compiled.programs.iter().any(|p| p.program.native) {
            return Err("E_ADOPT: a generated rollback view needs an authored native bundle; retain a compatible guarded source".into());
        }
        id = id.checked_add(1).ok_or("release identity exhausted")?;
        let root = stage.join("rollback-views").join(id.to_string());
        fs::create_dir_all(root.join("snapback")).map_err(|e| e.to_string())?;
        for (name, text) in &bridge.sources {
            let path = root.join("snapback").join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(path, text).map_err(|e| e.to_string())?;
        }
        let mut view = View {
            target,
            release: id,
            parent,
            digest: String::new(),
            changes: bridge.changes,
            hides: hides
                .iter()
                .map(|h| format!("{} where {} = null because {}", h.table, h.column, h.reason))
                .collect(),
        };
        fs::write(
            root.join("device-compatibility.json"),
            serde_json::to_vec_pretty(&snapback4_core::device_protocol::compatibility(
                &compiled.schema.public_projection(),
            ))
            .unwrap(),
        )
        .map_err(|e| e.to_string())?;
        view.digest = crate::release_files::executable_digest(&root)?;
        fs::write(
            root.join("rollback-view.json"),
            serde_json::to_vec_pretty(&view).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        views.push(view);
    }
    fs::write(
        stage.join("rollback-views.json"),
        serde_json::to_vec_pretty(&views).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(views)
}
pub(super) struct Installed {
    dir: PathBuf,
    parent: u64,
    ids: Vec<u64>,
    pub pending: bool,
}
impl Drop for Installed {
    fn drop(&mut self) {
        if !self.pending && super::releases::selectable(&self.dir, self.parent).is_err() {
            for id in &self.ids {
                let _ = fs::remove_dir_all(self.dir.join("releases").join(id.to_string()));
            }
        }
    }
}
pub(super) fn install(
    dir: &Path,
    stage: &Path,
    parent: u64,
    views: &[View],
) -> Result<Installed, String> {
    let mut installed = Installed {
        dir: dir.into(),
        parent,
        ids: Vec::new(),
        pending: false,
    };
    for v in views {
        let from = stage.join("rollback-views").join(v.release.to_string());
        crate::release_files::durable(&from)?;
        fs::rename(&from, dir.join("releases").join(v.release.to_string()))
            .map_err(|e| e.to_string())?;
        installed.ids.push(v.release);
    }
    if stage.join("rollback-views").exists() {
        fs::remove_dir(stage.join("rollback-views")).map_err(|e| e.to_string())?;
    }
    Ok(installed)
}

pub(super) fn needs_registration(dir:&Path,matched:Option<u64>,prepared:&[View])->Result<bool,String>{
    let held=matched.map(|n|manifest(&dir.join("releases").join(n.to_string()))).transpose()?.unwrap_or_default();
    for view in &held{verify(dir,view)?;}
    Ok(held.len()!=prepared.len()||prepared.iter().any(|v|!held.iter().any(|old|old.target==v.target&&old.digest==v.digest&&old.hides==v.hides)))
}
