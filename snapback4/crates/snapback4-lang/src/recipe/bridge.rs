//! The explicit, public social model supported by the optional feed bridge.
use snapback4_core::schema::{Audience, ColumnType, RuleExpr, RuleTerm, Schema, Table};

#[derive(Clone)]
pub struct Mapping {
    profiles: Vec<String>,
    posts: Vec<String>,
    follows: Vec<String>,
    reposts: Vec<String>,
}

impl Mapping {
    pub fn parse(profiles: &str, posts: &str, follows: &str, reposts: &str) -> Result<Self, String> {
        fn fields(flag: &str, value: &str, count: usize) -> Result<Vec<String>, String> {
            let fields: Vec<_> = value.split(':').map(str::to_owned).collect();
            if fields.len() != count || fields.iter().any(|field| !super::valid_prefix(field)) {
                return Err(format!("--{flag} needs {count} colon-separated Quarry identifiers; see `snapback4 guide feeds`"));
            }
            if fields[1..].iter().collect::<std::collections::BTreeSet<_>>().len() != count - 1 {
                return Err(format!("--{flag} must select distinct columns"));
            }
            Ok(fields)
        }
        let mapping = Self {
            profiles: fields("public-profiles", profiles, 2)?,
            posts: fields("public-posts", posts, 3)?,
            follows: fields("public-follows", follows, 3)?,
            reposts: fields("public-reposts", reposts, 4)?,
        };
        let tables = [&mapping.profiles[0], &mapping.posts[0], &mapping.follows[0], &mapping.reposts[0]];
        if tables.into_iter().collect::<std::collections::BTreeSet<_>>().len() != 4 {
            return Err("profiles, posts, follows and reposts must select four distinct application tables".into());
        }
        Ok(mapping)
    }

    // @ref LLP 3000.011.002.000#2 — type compatibility is not authorization to disclose app metadata.
    pub fn render(&self, schema: &Schema, prefix: &str) -> Result<String, String> {
        if !super::valid_prefix(prefix) {
            return Err("public bridges require a nonempty --prefix so the application owns every client-callable write".into());
        }
        let profiles = public_table(schema, &self.profiles[0])?;
        let posts = public_table(schema, &self.posts[0])?;
        let follows = public_table(schema, &self.follows[0])?;
        let reposts = public_table(schema, &self.reposts[0])?;
        for (mapping, table, kinds) in [
            (&self.profiles, profiles, vec![ColumnType::Principal]),
            (&self.posts, posts, vec![ColumnType::Principal, ColumnType::Time]),
            (&self.follows, follows, vec![ColumnType::Principal, ColumnType::Principal]),
            (&self.reposts, reposts, vec![ColumnType::Principal, ColumnType::Ref { table: self.posts[0].clone() }, ColumnType::Time]),
        ] {
            for (column, expected) in mapping[1..].iter().zip(kinds) {
                if table.columns.get(column) != Some(&expected) {
                    return Err(format!("{}.{} must be required {expected:?}; found {:?}", mapping[0], column, table.columns.get(column)));
                }
            }
            if !owned(&table.rules.insert, &mapping[1]) {
                return Err(format!("{} insert must require .{} = viewer", mapping[0], mapping[1]));
            }
            for (effect, rule) in [("update", &table.rules.update), ("delete", &table.rules.delete)] {
                if *rule != RuleExpr::Deny && !owned(rule, &mapping[1]) {
                    return Err(format!("{} {effect} must deny or require its owner .{} = viewer", mapping[0], mapping[1]));
                }
            }
            if table.rules.update != RuleExpr::Deny {
                for column in &mapping[1..] {
                    if !table.immutable_fields().any(|field| field == column) {
                        return Err(format!("{}.{} must be immutable when updates are allowed; the bridge cannot retarget an existing event or identity", mapping[0], column));
                    }
                }
            }
        }
        unique(profiles, &self.profiles[0], &self.profiles[1..])?;
        unique(follows, &self.follows[0], &self.follows[1..])?;
        unique(reposts, &self.reposts[0], &self.reposts[1..3])?;
        if posts.rules.delete != RuleExpr::Deny {
            return Err(format!("{} must deny deletion: this bridge retains the card for independent reposts; use the manual integration for another deletion policy", self.posts[0]));
        }
        if follows.rules.update != RuleExpr::Deny || reposts.rules.update != RuleExpr::Deny {
            return Err("follow edges and repost attribution must deny updates; remove and insert through the application's bridged mutations".into());
        }
        // @ref LLP 3000.011.002.000#6 — these helpers must delete the app row as well as its recipe state.
        for (mapping, table, helper) in [(&self.follows, follows, "AppUnfollow"), (&self.reposts, reposts, "AppUnrepost")] {
            if !owned(&table.rules.delete, &mapping[1]) {
                return Err(format!("{} delete must require .{} = viewer: {prefix}{helper} deletes the app row; use the manual integration if deletion must remain denied", mapping[0], mapping[1]));
            }
        }
        // Follow owns the app edge insertion. Other app rows remain authored
        // by the application, so extra required post/profile fields are fine.
        for (column, kind) in &follows.columns {
            if column != "id" && !self.follows[1..].contains(column) && !kind.is_optional() && !follows.defaults.contains_key(column) {
                return Err(format!("{}.{} needs an application value; use the manual follow bridge or give that extra column a default", self.follows[0], column));
            }
        }
        let names = [
            ("@PROFILES@", self.profiles[0].as_str()), ("@PRINCIPAL@", self.profiles[1].as_str()),
            ("@POSTS@", self.posts[0].as_str()), ("@AUTHOR@", self.posts[1].as_str()), ("@POST_TIME@", self.posts[2].as_str()),
            ("@FOLLOWS@", self.follows[0].as_str()), ("@FOLLOWER@", self.follows[1].as_str()), ("@FOLLOWED@", self.follows[2].as_str()),
            ("@REPOSTS@", self.reposts[0].as_str()), ("@ACTOR@", self.reposts[1].as_str()), ("@ORIGINAL@", self.reposts[2].as_str()), ("@REPOST_TIME@", self.reposts[3].as_str()),
        ];
        let mut source = include_str!("bridge.q").to_owned();
        for (placeholder, name) in names { source = source.replace(placeholder, name); }
        source = source.replace("@PREFIX@", prefix);
        Ok(source)
    }
}

fn public_table<'a>(schema: &'a Schema, name: &str) -> Result<&'a Table, String> {
    let table = schema.table(name).ok_or_else(|| format!("no application table {name}"))?;
    if schema.maintain_for(name).is_some() || !table.rules.read.is_public()
        || !table.sync.as_ref().is_some_and(|sync| sync.audience == Audience::Public && sync.horizon.is_none())
        || table.is_expiring() {
        return Err(format!("{name} must be an explicitly public, fully `sync public`, non-expiring application table; recipe events disclose its metadata publicly; keep private/online/horizon/expiring models on the manual integration path"));
    }
    Ok(table)
}

fn owned(rule: &RuleExpr, field: &str) -> bool {
    let owner = |term: &RuleTerm| matches!(term, RuleTerm::Field(name) | RuleTerm::OldField(name) | RuleTerm::NextField(name) if name == field);
    match rule {
        RuleExpr::Eq(a, RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, a) => owner(a),
        RuleExpr::And(rules) => rules.iter().any(|rule| owned(rule, field)),
        _ => false,
    }
}

fn unique(table: &Table, name: &str, columns: &[String]) -> Result<(), String> {
    let matches = table.indexes.values().filter(|index| index.unique && index.is_plain() && index.columns() == columns).count();
    if matches != 1 { return Err(format!("{name} needs exactly one total unique index on {}; found {matches}", columns.join(", "))); }
    Ok(())
}
