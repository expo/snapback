use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::PathBuf,
};

fn hex(s: &str) -> u32 {
    u32::from_str_radix(s.trim(), 16).unwrap()
}
fn zig(n: i64) -> u32 {
    if n < 0 {
        (-2 * n - 1) as u32
    } else {
        (2 * n) as u32
    }
}
fn nfd_length(cp: u32, ds: &BTreeMap<u32, Vec<u32>>, depth: u32, max: &mut u32) -> u32 {
    assert!(depth <= 32, "cyclic Unicode decomposition");
    *max = (*max).max(depth);
    if (0xac00..=0xd7a3).contains(&cp) {
        return if (cp - 0xac00) % 28 == 0 { 2 } else { 3 };
    }
    ds.get(&cp).map_or(1, |xs| {
        xs.iter().map(|c| nfd_length(*c, ds, depth + 1, max)).sum()
    })
}

pub fn generate() {
    let root =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../unicode/17.0.0");
    let read = |name: &str| {
        let path = root.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        fs::read_to_string(path).unwrap()
    };
    for line in read("SHA256SUMS").lines() {
        let mut fields = line.split_whitespace();
        let expected = fields.next().unwrap();
        let name = fields.next().unwrap();
        let actual = format!("{:x}", Sha256::digest(read(name).as_bytes()));
        assert_eq!(actual, expected, "Unicode 17 input hash mismatch: {name}");
    }
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=unicode_build.rs");
    let mut decomp = BTreeMap::new();
    let mut ccc = BTreeMap::new();
    let mut fold = BTreeMap::new();
    let mut boundary = BTreeSet::new();
    let mut excluded = BTreeSet::new();
    for line in read("UnicodeData.txt").lines() {
        let f: Vec<_> = line.split(';').collect();
        let cp = hex(f[0]);
        if f[2].starts_with('P') {
            boundary.insert(cp);
        }
        let cls: i64 = f[3].parse().unwrap();
        if cls != 0 {
            ccc.insert(cp, cls);
        }
        if !f[5].is_empty() && !f[5].starts_with('<') {
            decomp.insert(cp, f[5].split_whitespace().map(hex).collect::<Vec<_>>());
        }
    }
    for (name, prop, target) in [
        ("PropList.txt", "White_Space", &mut boundary),
        (
            "DerivedNormalizationProps.txt",
            "Full_Composition_Exclusion",
            &mut excluded,
        ),
    ] {
        for line in read(name).lines() {
            let f: Vec<_> = line
                .split('#')
                .next()
                .unwrap()
                .split(';')
                .map(str::trim)
                .collect();
            if f.get(1) != Some(&prop) {
                continue;
            }
            let mut pair = f[0].split("..");
            let start = hex(pair.next().unwrap());
            let end = pair.next().map(hex).unwrap_or(start);
            target.extend(start..=end);
        }
    }
    for line in read("CaseFolding.txt").lines() {
        let f: Vec<_> = line
            .split('#')
            .next()
            .unwrap()
            .split(';')
            .map(str::trim)
            .collect();
        if !matches!(f.get(1), Some(&"C" | &"S")) {
            continue;
        }
        assert_eq!(
            f[2].split_whitespace().count(),
            1,
            "simple fold arity changed"
        );
        fold.insert(hex(f[0]), hex(f[2]) as i64 - hex(f[0]) as i64);
    }
    let mut depth = 0;
    let max_nfd = decomp
        .keys()
        .map(|cp| nfd_length(*cp, &decomp, 0, &mut depth))
        .max()
        .unwrap()
        .max(3);
    assert_eq!(max_nfd, 4, "U = 4N proof changed");
    for (cp, delta) in &fold {
        assert!(
            nfd_length((*cp as i64 + delta) as u32, &decomp, 0, &mut depth)
                <= nfd_length(*cp, &decomp, 0, &mut depth),
            "simple folding increases NFD length"
        );
    }
    let mut columns: [Vec<u32>; 7] = Default::default();
    let mut previous = 0;
    let mut destinations = [0_i64; 2];
    for (cp, ds) in &decomp {
        assert!(ds.len() <= 2, "decomposition arity changed");
        columns[0].push(cp - previous);
        previous = *cp;
        columns[1].push(ds.len() as u32 * 2 + u32::from(excluded.contains(cp)));
        for (i, to) in ds.iter().enumerate() {
            columns[2 + i].push(zig(*to as i64 - destinations[i]));
            destinations[i] = *to as i64;
        }
    }
    for (column, entries) in [
        (4, ccc),
        (5, fold),
        (6, boundary.into_iter().map(|cp| (cp, 0)).collect()),
    ] {
        let mut ranges: Vec<(u32, u32, i64)> = Vec::new();
        for (cp, value) in entries {
            if let Some(last) = ranges.last_mut() {
                if last.1 + 1 == cp && last.2 == value {
                    last.1 = cp;
                    continue;
                }
            }
            ranges.push((cp, cp, value));
        }
        previous = 0;
        for (start, end, value) in ranges {
            columns[column].extend([start - previous, end - start]);
            previous = start;
            if column != 6 {
                columns[column].push(if column == 5 {
                    zig(value)
                } else {
                    value as u32
                });
            }
        }
    }
    let packed = columns.map(|xs| {
        let mut bytes = Vec::new();
        for mut n in xs {
            while n >= 128 {
                bytes.push((n as u8 & 127) | 128);
                n >>= 7;
            }
            bytes.push(n as u8);
        }
        bytes
    });
    let mut digest = Sha256::new();
    for bytes in &packed {
        digest.update((bytes.len() as u32).to_le_bytes());
        digest.update(bytes);
    }
    let source = format!(
        "// Generated from pinned Unicode 17 UCD; see unicode/17.0.0/LICENSE.txt.\n\
         pub const TABLE_DIGEST: &str = \"{:x}\";\n\
         pub const MAX_NFD_SCALARS: usize = {max_nfd};\n\
         pub const MAX_DECOMPOSITION_DEPTH: usize = {depth};\n\
         pub const PACKED: [&[u8]; 7] = [{}];\n",
        digest.finalize(),
        packed
            .iter()
            .map(|xs| format!("&{xs:?}"))
            .collect::<Vec<_>>()
            .join(",")
    );
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("unicode_tables.rs");
    if fs::read_to_string(&output).ok().as_ref() != Some(&source) {
        fs::write(output, source).unwrap();
    }
}
