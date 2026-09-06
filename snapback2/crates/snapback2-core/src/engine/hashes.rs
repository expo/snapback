use super::*;

// @ref LLP 1001#7-channels-schemachannels — authority binds the entire policy
// graph, including cycles. These are private facts of the Engine's schema,
// never a cache populated from an incoming certificate.
#[derive(Clone)]
pub(super) struct PolicyHashes {
    pub(super) schema: String,
    tables: BTreeMap<String, [String; 4]>,
    channels: BTreeMap<String, String>,
}

impl PolicyHashes {
    pub(super) fn new(schema: &Schema) -> Self {
        let hash = schema.hash();
        let tables = schema
            .tables
            .iter()
            .map(|(name, table)| (name.as_str(), table))
            .chain(std::iter::once((
                crate::CONNECTED_TABLE,
                &*crate::connected::TABLE,
            )))
            .map(|(name, table)| {
                (
                    name.to_owned(),
                    [Effect::Read, Effect::Insert, Effect::Update, Effect::Delete]
                        .map(|effect| digest(&(&hash, table.rules.for_effect(effect)))),
                )
            })
            .collect();
        let channels = schema
            .channels
            .values()
            .flat_map(|channel| [&channel.publish, &channel.subscribe])
            .map(|rule| (canonical_json(rule), digest(&(&hash, rule))))
            .collect();
        Self {
            schema: hash,
            tables,
            channels,
        }
    }

    pub(super) fn table(&self, table: &str, effect: Effect) -> &str {
        &self.tables[table][match effect {
            Effect::Read => 0,
            Effect::Insert => 1,
            Effect::Update => 2,
            Effect::Delete => 3,
        }]
    }

    pub(super) fn rule(&self, rule: &RuleExpr) -> String {
        self.channels
            .get(&canonical_json(rule))
            .cloned()
            .unwrap_or_else(|| digest(&(&self.schema, rule)))
    }
}
