//! Bounded records in an ordered frontier. Each record holds at most 64 heads.
//! A request checkpoints changed records, never an all-author serialization.
use super::*;

pub(super) const BLOCK_HEADS: u64 = 64;
pub(super) const BLOCK_BYTES: u64 = 32 * 1024;

#[derive(Clone)]
pub(super) struct Lane {
    pub actor: String,
    pub epoch: Option<String>,
    pub after: Option<Position>,
    pub block: u64,
}
#[derive(Clone)]
pub(super) struct Head {
    pub lane: Lane,
    pub event: Event,
}

impl Head {
    pub fn bytes(&self) -> u64 {
        1024 + 8
            * (self.lane.actor.len()
                + self.lane.epoch.as_ref().map_or(0, String::len)
                + self.lane.after.as_ref().map_or(0, |p| p.id.len())
                + self.event.string_bytes()) as u64
    }
}

#[derive(Default, Clone)]
pub(super) struct Frontier {
    blocks: BTreeMap<u64, Arc<Vec<Head>>>,
    greatest: BTreeMap<Position, u64>,
    pub bytes: u64,
    pub heads: usize,
}
impl Frontier {
    pub fn block_count(&self) -> usize {
        self.blocks.len()
    }
    pub fn fork_bytes(&self) -> u64 {
        self.greatest
            .keys()
            .map(|p| 1024 + p.id.len() as u64 * 8)
            .sum()
    }
    pub fn copy_bytes(&self, id: u64) -> u64 {
        self.blocks
            .get(&id)
            .filter(|b| Arc::strong_count(b) > 1)
            .map_or(0, |b| BLOCK_BYTES + b.iter().map(Head::bytes).sum::<u64>())
    }
    pub fn extra(&self, head: &Head) -> u64 {
        head.bytes()
            + if self.blocks.contains_key(&head.lane.block) {
                0
            } else {
                BLOCK_BYTES
            }
    }
    pub fn peek(&self) -> Option<&Head> {
        let (_, block) = self.greatest.last_key_value()?;
        self.blocks[block].last()
    }
    pub fn put(&mut self, head: Head) {
        let id = head.lane.block;
        self.bytes += self.extra(&head);
        let block = self
            .blocks
            .entry(id)
            .or_insert_with(|| Arc::new(Vec::with_capacity(BLOCK_HEADS as usize)));
        let block = Arc::make_mut(block);
        if let Some(old) = block.last() {
            self.greatest.remove(&old.event.position());
        }
        assert!(block.len() < BLOCK_HEADS as usize);
        let index = block.partition_point(|old| old.event.position() < head.event.position());
        block.insert(index, head);
        self.greatest
            .insert(block.last().unwrap().event.position(), id);
        self.heads += 1;
    }
    pub fn pop(&mut self) -> Option<Head> {
        let (key, id) = self.greatest.pop_last()?;
        let block = Arc::make_mut(self.blocks.get_mut(&id).unwrap());
        let head = block.pop().unwrap();
        assert_eq!(key, head.event.position());
        self.bytes -= head.bytes();
        self.heads -= 1;
        if let Some(next) = block.last() {
            self.greatest.insert(next.event.position(), id);
        } else {
            self.blocks.remove(&id);
            self.bytes -= BLOCK_BYTES;
        }
        Some(head)
    }
    /// Physical custody is released a bounded record at a time.
    pub fn reclaim_block(&mut self) -> bool {
        let Some((_, block)) = self.blocks.pop_first() else {
            return false;
        };
        self.greatest
            .remove(&block.last().unwrap().event.position());
        self.bytes -= BLOCK_BYTES + block.iter().map(Head::bytes).sum::<u64>();
        self.heads -= block.len();
        true
    }
}
