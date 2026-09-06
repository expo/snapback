use std::sync::OnceLock;
include!(concat!(env!("OUT_DIR"), "/unicode_tables.rs"));
pub const MAX_LOOKUP_PROBES: usize = 12;

// Own the binary-probe bound: std::slice::partition_point may perform an extra
// final predicate call. This is the same half-open lower-bound loop as the TS tables.
pub(crate) fn lower_bound(len: usize, mut before: impl FnMut(usize) -> bool) -> usize {
    let (mut lo, mut hi) = (0, len);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if before(mid) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

pub struct Tables {
    pub decomposition: Vec<[u32; 4]>,
    pub composition: Vec<[u32; 3]>,
    pub combining: Vec<[i32; 3]>,
    pub folding: Vec<[i32; 3]>,
    pub boundaries: Vec<[i32; 3]>,
}

fn unpack(bytes: &[u8]) -> Vec<u32> {
    let (mut n, mut shift) = (0, 0);
    let mut out = Vec::new();
    for b in bytes {
        n |= u32::from(b & 127) << shift;
        if b & 128 != 0 {
            shift += 7;
        } else {
            out.push(n);
            n = 0;
            shift = 0;
        }
    }
    out
}
fn unzig(n: u32) -> i32 {
    if n & 1 != 0 {
        -((n + 1) as i32 / 2)
    } else {
        (n / 2) as i32
    }
}

pub fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(|| {
        let columns = PACKED.map(unpack);
        let (mut cp, mut previous, mut positions) = (0, [0_i32; 2], [0; 2]);
        let mut decomposition = Vec::new();
        let mut composition = Vec::new();
        for i in 0..columns[0].len() {
            cp += columns[0][i];
            let flag = columns[1][i];
            let mut xs = [0; 2];
            for j in 0..(flag >> 1) as usize {
                previous[j] += unzig(columns[2 + j][positions[j]]);
                positions[j] += 1;
                xs[j] = previous[j] as u32;
            }
            decomposition.push([cp, xs[0], xs[1], flag >> 1]);
            if flag >> 1 == 2 && flag & 1 == 0 {
                composition.push([xs[0], xs[1], cp]);
            }
        }
        composition.sort_unstable();
        let ranges = |column: usize| {
            let (mut cp, mut i) = (0, 0);
            let xs = &columns[column];
            let mut out = Vec::new();
            while i < xs.len() {
                cp += xs[i];
                i += 1;
                let end = cp + xs[i];
                i += 1;
                let value = if column == 6 {
                    1
                } else {
                    let n = xs[i];
                    i += 1;
                    if column == 5 { unzig(n) } else { n as i32 }
                };
                out.push([cp as i32, end as i32, value]);
            }
            out
        };
        Tables {
            decomposition,
            composition,
            combining: ranges(4),
            folding: ranges(5),
            boundaries: ranges(6),
        }
    })
}

pub fn range_value(table: &[[i32; 3]], cp: u32) -> i32 {
    let i = lower_bound(table.len(), |i| table[i][1] < cp as i32);
    table
        .get(i)
        .filter(|r| r[0] <= cp as i32)
        .map_or(0, |r| r[2])
}
pub fn decompose_at(cp: u32) -> Option<&'static [u32; 4]> {
    let ds = &tables().decomposition;
    let i = lower_bound(ds.len(), |i| ds[i][0] < cp);
    ds.get(i).filter(|r| r[0] == cp)
}
pub fn compose_pair(a: u32, b: u32) -> Option<u32> {
    if (0x1100..0x1113).contains(&a) && (0x1161..0x1176).contains(&b) {
        return Some(0xac00 + ((a - 0x1100) * 21 + b - 0x1161) * 28);
    }
    if (0xac00..=0xd7a3).contains(&a) && (a - 0xac00) % 28 == 0 && (0x11a8..0x11c3).contains(&b) {
        return Some(a + b - 0x11a7);
    }
    let cs = &tables().composition;
    let i = lower_bound(cs.len(), |i| [cs[i][0], cs[i][1]] < [a, b]);
    cs.get(i).filter(|r| r[0] == a && r[1] == b).map(|r| r[2])
}
