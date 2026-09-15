//! The published Quarry, shared by the server and both device witnesses.
#![allow(dead_code)]
use snapback4_core::{Value, engine::QueryOutcome, value::object};
use std::collections::{BTreeMap, BTreeSet};

pub fn source() -> &'static str {
    snapback4_lang::guide::card("search").unwrap().split_once("## Search every chat I'm in").unwrap().1
        .split_once("```quarry\n").unwrap().1.split_once("```").unwrap().0
}

pub fn seed(memberships: usize) -> Vec<(String, Value)> {
    let mut rows = Vec::new();
    // One extra chat is unreadable to the measured viewer, with newer hits.
    for room in 0..=memberships {
        let room_id = format!("r{room:04}");
        rows.push(("members".into(), object([("id", Value::Id(format!("member{room:04}"))), ("roomId", Value::Id(room_id.clone())),
            ("principal", Value::Id(if room == memberships { "dev:bob" } else { "dev:alice" }.into()))])));
        for n in 0..30 {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room_id}-{n:02}"))), ("roomId", Value::Id(room_id.clone())),
                ("body", Value::String(if n < 24 { "coffee" } else { "tea" }.into())), ("at", Value::Int(if room == memberships { 1000 + n } else { n }))])));
        }
    }
    rows
}

#[derive(Default, Debug)]
pub struct Walk {
    pub pages: usize,
    pub first_examined: u64,
    pub max_examined: u64,
    pub examined: u64,
    pub all_complete: bool,
    pub ids: BTreeSet<String>,
    pub groups: BTreeMap<String, usize>,
    ordered_ids: Vec<String>,
    last_key: Option<(i64, String)>,
}

impl Walk {
    pub fn new() -> Self { Self { all_complete: true, ..Self::default() } }
    pub fn start_batch(&mut self) { self.last_key = None; }
    pub fn add(&mut self, page: &QueryOutcome) {
        if self.pages == 0 { self.first_examined = page.metered.examined; }
        self.pages += 1;
        assert!(self.pages <= 2000, "cursor must make progress");
        self.examined += page.metered.examined;
        self.max_examined = self.max_examined.max(page.metered.examined);
        self.all_complete &= page.complete;
        assert!(page.capped_at.is_none() && page.word_cut_at.is_none(), "{page:?}");
        let rows = page.data.as_array().unwrap();
        for row in rows {
            let id = row.field("id").unwrap().as_str().unwrap().to_owned();
            let key = (row.field("at").unwrap().as_int().unwrap(), id.clone());
            assert!(self.last_key.as_ref().is_none_or(|last| last > &key), "newest first across page boundaries, id breaks ties");
            self.last_key = Some(key);
            assert!(self.ids.insert(id.clone()), "duplicate across pages");
            self.ordered_ids.push(id);
            *self.groups.entry(row.field("roomId").unwrap().as_str().unwrap().to_owned()).or_default() += 1;
        }
    }
    pub fn assert_matches(&self, memberships: usize, hits_per_room: usize, batch_size: usize) {
        let expected = (0..memberships).step_by(batch_size).flat_map(|start| {
            (24 - hits_per_room..24).rev().flat_map(move |n| (start..(start + batch_size).min(memberships)).rev().map(move |room| format!("r{room:04}-{n:02}")))
        }).collect::<Vec<_>>();
        assert_eq!(self.ids, expected.iter().cloned().collect(), "exact expected id set");
        assert_eq!(self.ordered_ids, expected, "exact ordering throughout each batch, across page boundaries");
        assert_eq!(self.groups.len(), memberships);
        assert_eq!(self.ids.len(), memberships * hits_per_room);
        for room in 0..memberships { assert_eq!(self.groups[&format!("r{room:04}")], hits_per_room); }
        assert!(!self.groups.contains_key(&format!("r{memberships:04}")), "no unreadable chat");
    }
    pub fn print(&self, form: &str, memberships: usize) {
        println!("W7d {form}: memberships={memberships} hits={} chats={} pages={} examined_first={} examined_max={} examined_total={} complete={}",
            self.ids.len(), self.groups.len(), self.pages, self.first_examined, self.max_examined, self.examined, self.all_complete);
    }
}
