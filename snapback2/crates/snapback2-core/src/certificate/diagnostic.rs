//! Explain the same products the analyzer charges, separately for each meter.
// @ref LLP 1001#3-read-and-write-states-no-silent-states — each meter names its dominant cause and preserves the requested result in its repair.
use super::*;

#[derive(Clone)]
pub(super) enum Repair {
    Range {
        nested: bool,
    },
    Merge,
    Cap {
        name: String,
        calls: u64,
        per_call: u64,
        maintain_line: Option<String>,
    },
    Probe,
    Uniformity,
    Work,
}

#[derive(Clone)]
pub(super) struct Cost {
    pub value: u64,
    pub source: String,
    pub repair: Repair,
}

fn context(factors: &[(String, u64)]) -> String {
    if factors.is_empty() {
        return String::new();
    }
    format!(
        " (calls from {})",
        factors
            .iter()
            .map(|(name, n)| format!("{name} {n}"))
            .collect::<Vec<_>>()
            .join(" × ")
    )
}

impl Cost {
    pub fn range(scan: &Scan, calls: u64, factors: &[(String, u64)], reserve: u64) -> Self {
        let take = scan.take.maximum();
        let (source, repair) = if let Some(merge) = &scan.merge_site {
            (
                format!(
                    "merge {merge}: {calls} lanes {} at {} on {}{}",
                    if reserve == 1 {
                        "heads".to_owned()
                    } else {
                        format!("× ({take} + 2)")
                    },
                    scan.site,
                    scan.table,
                    context(factors)
                ),
                Repair::Merge,
            )
        } else {
            (
                format!(
                    "{} take {take} (+2 reserve) × {calls} calls on {}{}",
                    scan.site,
                    scan.table,
                    context(factors)
                ),
                Repair::Range {
                    nested: !factors.is_empty(),
                },
            )
        };
        Self {
            value: calls.saturating_mul(reserve),
            source,
            repair,
        }
    }
    // @ref LLP 1017#24-metering — each reserved cap names whether it scans N
    // candidates or reads one same-key maintained count.
    pub fn cap(
        table: &str,
        by: &[String],
        max: u32,
        maintained_target: Option<&str>,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Self {
        let name = format!("cap {max} by {} on {table}", by.join(", "));
        let per_call = if maintained_target.is_some() {
            1
        } else {
            u64::from(max)
        };
        let source = maintained_target.map_or_else(
            || format!("{calls} calls × {name}{}", context(factors)),
            |target| {
                format!(
                    "{calls} calls × maintained {name} via {target}.byId (1 row per write){}",
                    context(factors)
                )
            },
        );
        Self {
            value: calls.saturating_mul(per_call),
            source,
            repair: Repair::Cap {
                name,
                calls,
                per_call,
                // A complete declaration the builder can paste: the count needs its
                // own read rule, and `deny` keeps the count private until relaxed.
                maintain_line: (maintained_target.is_none() && max > 1).then(|| {
                    format!(
                        "maintain {table}Counts = count {table} by {}:\n  read <- deny",
                        by.join(", ")
                    )
                }),
            },
        }
    }
    fn scaled(mut self, n: u64) -> Self {
        self.value = self.value.saturating_mul(n);
        if let Repair::Cap { per_call, .. } = &mut self.repair {
            *per_call = per_call.saturating_mul(n);
        }
        self.source = format!("{} × {n}", self.source);
        self
    }
    pub fn rewrite(&self, actual: u64, ceiling: u64) -> String {
        match &self.repair {
            Repair::Merge => "structural repair: use a smaller lane bound, a smaller page, two reads (they are two snapshots), or a maintained feed".into(),
            Repair::Cap {
                name,
                calls,
                per_call,
                maintain_line,
            } => {
                let other = actual.saturating_sub(self.value);
                let fits = ceiling
                    .saturating_sub(other)
                    .saturating_div((*per_call).max(1))
                    .min(*calls);
                let chunk = if fits == 0 {
                    format!("structural repair: {name} leaves no positive chunk size under this ceiling with the other reserves unchanged; reduce the other work or split the job")
                } else {
                    format!("reduce the chunk from {calls} to at most {fits} writes for {name}; {fits} fits this ceiling with the other reserves unchanged")
                };
                if let Some(line) = maintain_line {
                    format!(
                        "add this schema maintain with its read rule:\n{line}\nthe cap probe then prices at one row per write; {chunk}"
                    )
                } else {
                    chunk
                }
            }
            Repair::Range { nested: true } => "replace the nested population scan with maintain.count/sum, or reduce its declared bound".into(),
            Repair::Range { nested: false } => "reduce the named range's page bound, or read a maintained aggregate".into(),
            Repair::Probe => "reduce the named rule-probe product by pinning the authorization scope in the scan prefix or reducing its call bound".into(),
            Repair::Uniformity => "make the read rule uniform over the scan prefix by pinning its authorization scope; a smaller page does not reduce the non-uniform budget reserve".into(),
            Repair::Work => "reduce the named expression, statement, or write repetition bound".into(),
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct WorkTerms([Vec<Cost>; 4]);
impl WorkTerms {
    pub fn add(&mut self, other: Self) {
        for (target, source) in self.0.iter_mut().zip(other.0) {
            target.extend(source);
        }
    }
    pub fn branch(&mut self, other: &Self, wins: [bool; 4]) {
        for (i, win) in wins.into_iter().enumerate() {
            if win {
                self.0[i] = other.0[i].clone();
            }
        }
    }
    pub fn scan(&mut self, cost: Cost) {
        self.0[0].push(cost.clone());
        self.0[1].push(cost.clone());
        self.0[3].push(cost.scaled(5));
    }
    pub fn read(&mut self, read: &Read, calls: u64, factors: &[(String, u64)]) {
        let cost = Cost {
            value: calls,
            source: format!(
                "{} point read on {} × {calls} calls{}",
                read.site,
                read.table,
                context(factors)
            ),
            repair: Repair::Range {
                nested: !factors.is_empty(),
            },
        };
        self.0[0].push(cost.clone());
        self.0[1].push(cost.clone());
        self.0[3].push(cost.scaled(4));
    }
    pub fn step(&mut self, value: u64, label: &str, factors: &[(String, u64)]) {
        self.0[3].push(Cost {
            value,
            source: format!("{label}{}", context(factors)),
            repair: Repair::Work,
        });
    }
    pub fn probes(&mut self, site: &str, calls: u64, per_call: u64, factors: &[(String, u64)]) {
        self.0[2].push(Cost {
            value: calls.saturating_mul(per_call),
            source: format!(
                "{site}: {calls} calls × {per_call} rule probes{}",
                context(factors)
            ),
            repair: Repair::Probe,
        });
    }
    pub fn product(&self) -> Option<String> {
        let terms = sorted_terms(self.for_meter("examined entries"));
        (!terms.is_empty()).then(|| {
            terms
                .iter()
                .map(|t| format!("{} = {}", t.source, t.value))
                .collect::<Vec<_>>()
                .join(" + ")
        })
    }
    pub fn for_meter(&self, name: &str) -> Vec<Cost> {
        let (i, scale) = match name {
            "examined entries" => (0, 1),
            "index entries" => (1, 1),
            "rule probes" => (2, 1),
            "heap bytes" => (3, HEAP_BYTES_PER_STEP),
            _ => (3, 1),
        };
        self.0[i]
            .iter()
            .cloned()
            .map(|term| if scale == 1 { term } else { term.scaled(scale) })
            .collect()
    }
}

pub(super) fn sorted_terms(terms: Vec<Cost>) -> Vec<Cost> {
    let mut combined = BTreeMap::<String, Cost>::new();
    let mut terms_out = Vec::new();
    for term in terms.into_iter().filter(|term| term.value > 0) {
        if matches!(term.repair, Repair::Work) {
            combined
                .entry(term.source.clone())
                .and_modify(|old| old.value = old.value.saturating_add(term.value))
                .or_insert(term);
        } else {
            terms_out.push(term);
        }
    }
    let mut terms = terms_out;
    terms.extend(combined.into_values());
    terms.sort_by(|a, b| b.value.cmp(&a.value).then(a.source.cmp(&b.source)));
    terms
}

impl Checker<'_> {
    pub(super) fn check_ceiling(
        &self,
        name: &str,
        actual: u64,
        ceiling: u64,
        summary: &Summary,
        bytes: Option<&crate::collection_rewrite::ByteShape>,
    ) -> Result<(), CheckError> {
        if actual <= ceiling {
            return Ok(());
        }
        let (product, rewrite) = if let Some(shape) = bytes {
            (shape.render(), shape.rewrite())
        } else {
            let mut terms = summary.costs.for_meter(name);
            let total = terms.iter().fold(0_u64, |n, c| n.saturating_add(c.value));
            if actual > total {
                terms.push(Cost {
                    value: actual - total,
                    source: "rule evaluation / non-uniform budget reserve".into(),
                    repair: Repair::Uniformity,
                });
            }
            let terms = sorted_terms(terms);
            let maintain_line = terms.iter().find_map(|term| match &term.repair {
                Repair::Cap {
                    maintain_line: Some(line),
                    ..
                } => Some(line),
                _ => None,
            });
            let mut rewrite = terms
                .first()
                .map(|t| t.rewrite(actual, ceiling))
                .unwrap_or_else(|| "reduce the declared work bound".into());
            if name != "steps"
                && let Some(line) = maintain_line
                && !rewrite.contains(line)
            {
                rewrite.push_str(&format!(
                    "; add this schema maintain with its read rule:\n{line}\nthe cap probe then prices at one row per write"
                ));
            }
            (
                terms
                    .iter()
                    .map(|t| format!("{} = {}", t.source, t.value))
                    .collect::<Vec<_>>()
                    .join(" + "),
                rewrite,
            )
        };
        Err(CheckError {
            site: None,
            code: if name == "steps" {
                "E_STEPS"
            } else {
                "E_BOUND"
            }
            .into(),
            message: format!("{name} {actual} exceeds ceiling {ceiling}; product: {product}"),
            rewrite,
        })
    }
}
