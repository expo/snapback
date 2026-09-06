use super::*;
use crate::unicode_tables::*;
use std::collections::{BTreeMap, BTreeSet};

const NFC: &str = include_str!("../../../unicode/17.0.0/NormalizationTest.txt");
const UCD: &str = include_str!("../../../unicode/17.0.0/UnicodeData.txt");
const FOLD: &str = include_str!("../../../unicode/17.0.0/CaseFolding.txt");
const PROPS: &str = include_str!("../../../unicode/17.0.0/PropList.txt");
fn hex(s: &str) -> u32 {
    u32::from_str_radix(s.trim(), 16).unwrap()
}
fn string(s: &str) -> String {
    s.split_whitespace()
        .map(|cp| char::from_u32(hex(cp)).unwrap())
        .collect()
}

#[test]
fn official_normalization_conformance() {
    let mut n = SearchNormalizer::default();
    let mut cases = 0;
    let mut section = "";
    let mut part1 = BTreeSet::new();
    for line in NFC.lines() {
        let content = line.split('#').next().unwrap().trim();
        if content.starts_with('@') {
            section = content.split(';').next().unwrap();
            continue;
        }
        if content.is_empty() {
            continue;
        }
        let cs: Vec<_> = content.split(';').take(5).map(string).collect();
        if section == "@Part1" {
            part1.insert(cs[0].chars().next().unwrap());
        }
        for i in 0..5 {
            assert_eq!(
                n.nfc(&cs[i], 100).unwrap().0,
                cs[if i < 3 { 1 } else { 3 }],
                "{content}"
            );
        }
        cases += 1;
    }
    assert_eq!(cases, 20034);
    // Official Part1 also requires every unlisted scalar to be NFC-identity.
    for cp in (0..0x110000)
        .filter_map(char::from_u32)
        .filter(|cp| !part1.contains(cp))
    {
        let source = cp.to_string();
        assert_eq!(
            n.nfc(&source, 1).unwrap().0,
            source,
            "unlisted U+{:04X}",
            cp as u32
        );
    }
}

#[test]
fn official_folds_boundaries_and_finite_expansion_proof() {
    assert_eq!(
        TABLE_DIGEST,
        "29bb626cbddaec2bce2cc1efcac329a9ea07ee725322155b791005cd7781b9e8"
    );
    assert_eq!(MAX_NFD_SCALARS, 4);
    assert_eq!(MAX_DECOMPOSITION_DEPTH, 3);
    let t = tables();
    for count in [
        t.decomposition.len(),
        t.composition.len(),
        t.combining.len(),
        t.folding.len(),
        t.boundaries.len(),
    ] {
        assert!(count < 1 << MAX_LOOKUP_PROBES);
    }
    let mut ds = BTreeMap::new();
    let mut boundaries = vec![false; 0x110000];
    for line in UCD.lines() {
        let f: Vec<_> = line.split(';').collect();
        let cp = hex(f[0]);
        if f[2].starts_with('P') {
            boundaries[cp as usize] = true;
        }
        if !f[5].is_empty() && !f[5].starts_with('<') {
            ds.insert(cp, f[5].split_whitespace().map(hex).collect::<Vec<_>>());
        }
    }
    for line in PROPS.lines() {
        let f: Vec<_> = line
            .split('#')
            .next()
            .unwrap()
            .split(';')
            .map(str::trim)
            .collect();
        if f.get(1) != Some(&"White_Space") {
            continue;
        }
        let mut pair = f[0].split("..");
        let start = hex(pair.next().unwrap());
        let end = pair.next().map(hex).unwrap_or(start);
        boundaries[start as usize..=end as usize].fill(true);
    }
    fn nfd_len(cp: u32, ds: &BTreeMap<u32, Vec<u32>>) -> usize {
        if (0xac00..=0xd7a3).contains(&cp) {
            return if (cp - 0xac00) % 28 == 0 { 2 } else { 3 };
        }
        ds.get(&cp)
            .map_or(1, |xs| xs.iter().map(|c| nfd_len(*c, ds)).sum())
    }
    let mut folds = BTreeMap::new();
    for line in FOLD.lines() {
        let f: Vec<_> = line
            .split('#')
            .next()
            .unwrap()
            .split(';')
            .map(str::trim)
            .collect();
        if matches!(f.get(1), Some(&"C" | &"S")) {
            folds.insert(hex(f[0]), hex(f[2]));
        }
    }
    assert_eq!(folds.len(), 1512);
    let mut max = 0;
    for c in (0..0x110000).filter_map(char::from_u32) {
        let cp = c as u32;
        max = max.max(nfd_len(cp, &ds));
        assert_eq!(
            is_search_boundary(c),
            boundaries[cp as usize],
            "boundary U+{cp:04X}"
        );
        assert_eq!(
            (cp as i32 + range_value(&t.folding, cp)) as u32,
            *folds.get(&cp).unwrap_or(&cp),
            "fold U+{cp:04X}"
        );
    }
    assert_eq!(max, 4);
    for (cp, to) in folds {
        assert!(nfd_len(to, &ds) <= nfd_len(cp, &ds));
        assert_eq!(
            normalize_search(&char::from_u32(cp).unwrap().to_string(), 1),
            normalize_search(&char::from_u32(to).unwrap().to_string(), 1)
        );
    }
}

#[test]
fn owned_lower_bound_obeys_the_pinned_probe_ceiling() {
    let t = tables();
    let mut largest = 0;
    for len in [
        t.decomposition.len(),
        t.composition.len(),
        t.combining.len(),
        t.folding.len(),
        t.boundaries.len(),
    ] {
        for pivot in 0..=len {
            let mut probes = 0;
            let result = lower_bound(len, |i| {
                probes += 1;
                i < pivot
            });
            assert_eq!(result, pivot);
            assert!(
                probes <= MAX_LOOKUP_PROBES,
                "{len} rows / pivot {pivot}: {probes} probes"
            );
            largest = largest.max(probes);
        }
    }
    assert_eq!(largest, MAX_LOOKUP_PROBES);
}

#[test]
fn scalar_validation_and_independent_optional_fields() {
    assert_eq!(MAX_SEARCH_SOURCE_SCALARS, 0x3fff_ffff);
    for cp in 0..0x20 {
        let s = char::from_u32(cp).unwrap().to_string();
        assert_eq!(normalize_search(&s, 1).unwrap(), s);
        if [9, 10, 13].contains(&cp) {
            assert_eq!(
                search_query_token(&s, 1, &mut SearchNormalizer::default()).unwrap(),
                None
            );
        } else {
            assert!(search_query_token(&s, 1, &mut SearchNormalizer::default()).is_err());
            assert!(search_words(Some(&s), 1).is_err());
        }
    }
    for bytes in [
        vec![0xed, 0xa0, 0x80],
        vec![0xed, 0xbf, 0xbf],
        vec![0xc0, 0x80],
        vec![0xf4, 0x90, 0x80, 0x80],
        vec![0xf0, 0x90],
    ] {
        assert_eq!(scalar_text(&bytes, 100).unwrap_err().code(), "E_INPUT");
    }
    assert_eq!(scalar_length("𐐀", 1), Ok(1));
    assert!(scalar_length("𐐀a", 1).is_err());
    assert!(scalar_length("", 0x4000_0000).is_err());
    assert_eq!(search_words(None, 0).unwrap(), Vec::<String>::new());
    assert_eq!(
        search_field_words(&[
            (Some("a"), 1),
            (None, 4000),
            (Some("\u{301}"), 1),
            (Some("b A"), 3)
        ])
        .unwrap(),
        ["a", "\u{301}", "b"]
    );
    assert_eq!(
        search_field_words(&[(Some("foo"), 3), (Some("bar"), 3)]).unwrap(),
        ["foo", "bar"]
    );
    assert_eq!(
        search_words(
            Some("Élodie E\u{301}lodie foo—bar don’t stop\u{a0}here"),
            100
        )
        .unwrap(),
        ["élodie", "foo", "bar", "don", "t", "stop", "here"]
    );
    assert_eq!(
        search_words(Some("ſẞİıΣς Straße STRASSE 🦉+☕ a_b-c'd"), 100).unwrap(),
        ["sßİıσσ", "straße", "strasse", "🦉+☕", "a", "b", "c", "d"]
    );
    let mut n = SearchNormalizer::default();
    assert_eq!(search_query_token(" \t—", 3, &mut n).unwrap(), None);
    for source in ["foo foo", "FOO foo", "É E\u{301}", "foo-bar"] {
        assert_eq!(
            search_query_token(source, 100, &mut n).unwrap_err(),
            SearchInputError("search one word")
        );
    }
}

#[test]
fn stable_linear_reordering_and_maximum_scratch() {
    for (source, expected) in [
        (
            "\u{315}\u{300}".repeat(1000),
            "\u{300}".repeat(1000) + &"\u{315}".repeat(1000),
        ),
        (
            "a".to_string() + &"\u{315}\u{300}".repeat(1000),
            "à".to_string() + &"\u{300}".repeat(999) + &"\u{315}".repeat(1000),
        ),
        ("a\u{315}\u{300}".repeat(1000), "à\u{315}".repeat(1000)),
        ("a\u{301}\u{300}".to_owned(), "á\u{300}".to_owned()),
        ("𐐀".repeat(2000), "𐐨".repeat(2000)),
        (
            "\u{1d160}".repeat(2000),
            "\u{1d158}\u{1d165}\u{1d16e}".repeat(2000),
        ),
        ("\u{1f82}".repeat(4000), "\u{1f82}".repeat(4000)),
    ] {
        let n = source.chars().count();
        let u = 4 * n;
        let (text, s) = SearchNormalizer::default().normalize(&source, n).unwrap();
        assert_eq!(text, expected);
        assert!(s.output_scalars <= u && s.peak_scalars <= u);
        assert_eq!(s.scratch_bytes, 80 * n + 1028);
        assert!(s.scratch_bytes <= normalization_scratch_bytes(n).unwrap());
        assert_eq!(s.ccc_bucket_visits, 1024);
        assert!(s.reorder_visits <= 8 * u);
        assert!(s.segment_bucket_visits <= 4 * u + 4);
        assert!(normalization_steps(&s) <= normalization_step_bound(n).unwrap());
    }
    let mut n = SearchNormalizer::default();
    assert_eq!(
        n.normalize(&"x".repeat(2000), 2000)
            .unwrap()
            .1
            .scratch_bytes,
        161028
    );
    assert_eq!(n.normalize("x", 1).unwrap().1.scratch_bytes, 161028);
    assert_eq!(
        n.normalize(&"x".repeat(4000), 4000)
            .unwrap()
            .1
            .scratch_bytes,
        321028
    );
}

#[test]
fn shared_normalization_pass_ledger() {
    let (text, s) = SearchNormalizer::default()
        .normalize("É E\u{301} 가", 20)
        .unwrap();
    assert_eq!(text, "é é 가");
    assert_eq!(
        s,
        NormalizationStats {
            input_scalars: 7,
            output_scalars: 5,
            output_chunks: 0,
            decomposition_visits: 18,
            reorder_visits: 64,
            ccc_bucket_visits: 1024,
            segment_bucket_visits: 28,
            composition_visits: 16,
            fold_visits: 5,
            table_lookups: 84,
            peak_scalars: 8,
            scratch_bytes: 1588
        }
    );
}
