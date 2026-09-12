//! Typed channel records and certified durable-rule admission.
// @ref LLP 1001.000#declaration-and-value — the ephemeral value uses ordinary argument validation.
use crate::{ArgType, Channel, ChannelSide, ChannelVerdict, Runtime, RuntimeError, Schema, Value};
use crate::{CommitRecord, Context};
use std::collections::BTreeMap;

impl Runtime {
    pub fn channel_admit(
        &mut self,
        name: &str,
        side: ChannelSide,
        args: &BTreeMap<String, Value>,
        context: &Context,
    ) -> Result<ChannelVerdict, RuntimeError> {
        let channel = self
            .generation
            .schema
            .channels
            .get(name)
            .cloned()
            .ok_or_else(|| RuntimeError::Input(format!("unknown channel {name}")))?;
        let mut args = args.clone();
        crate::engine::complete_optional_args(&channel.args, &mut args);
        if args.len() != channel.args.len() {
            return Err(RuntimeError::Input(format!(
                "channel {name} expected {} args, got {}",
                channel.args.len(),
                args.len()
            )));
        }
        for (arg, kind) in &channel.args {
            let value = args
                .get(arg)
                .ok_or_else(|| RuntimeError::Input(format!("channel {name} missing arg {arg}")))?;
            crate::engine::validate_typed_arg_value(
                &self.generation.schema,
                kind,
                value,
                &format!("channel {name} arg {arg}"),
            )?;
            if matches!(kind, ArgType::Scalar)
                && matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_))
            {
                return Err(RuntimeError::Input(format!(
                    "channel {name} arg {arg} must be scalar"
                )));
            }
        }
        let certificates = self
            .generation
            .channel_certificates
            .get(name)
            .ok_or_else(|| {
                RuntimeError::TraceSubset(format!("channel {name} lacks certificate"))
            })?;
        let (rule, certificate) = match side {
            ChannelSide::Publish => (channel.publish, &certificates.publish),
            ChannelSide::Subscribe => (channel.subscribe, &certificates.subscribe),
        };
        let row = Value::Row(args.clone().into());
        let (admitted, trace) =
            self.engine
                .probe_rule(&rule, &row, context.clone(), Some(certificate))?;
        Ok(ChannelVerdict {
            admitted,
            rule_inputs: trace.rule_inputs,
            points: trace.points,
        })
    }

    pub fn channel_touched(commit: &CommitRecord, verdict: &ChannelVerdict) -> bool {
        commit.touched.iter().any(|touched| {
            verdict.rule_inputs.iter().any(|input| {
                input.table == touched.table
                    && input.index == touched.index
                    && input.key == touched.key
            }) || verdict.points.iter().any(|point| {
                point.table == touched.table
                    && point.index == touched.index
                    && point.key == touched.key
            })
        })
    }

    pub fn channel_value(
        &self,
        name: &str,
        mut value: BTreeMap<String, Value>,
    ) -> Result<BTreeMap<String, Value>, RuntimeError> {
        let channel = self
            .generation()
            .schema()
            .channels
            .get(name)
            .ok_or_else(|| RuntimeError::Input(format!("unknown channel {name}")))?;
        crate::engine::complete_optional_args(&channel.value, &mut value);
        if value.len() != channel.value.len()
            || value.keys().any(|key| !channel.value.contains_key(key))
        {
            return Err(RuntimeError::Input(format!(
                "channel {name} value must contain only its declared fields"
            )));
        }
        for (field, kind) in &channel.value {
            let supplied = value.get(field).ok_or_else(|| {
                RuntimeError::Input(format!("channel {name} value missing {field}"))
            })?;
            crate::engine::validate_typed_arg_value(
                self.generation().schema(),
                kind,
                supplied,
                &format!("channel {name} value {field}"),
            )?;
            if matches!(kind, ArgType::Scalar)
                && matches!(supplied, Value::Array(_) | Value::Row(_) | Value::Map(_))
            {
                return Err(RuntimeError::Input(format!(
                    "channel {name} value {field} must be scalar"
                )));
            }
        }
        Ok(value)
    }
}

pub(crate) fn schema_errors(schema: &Schema, name: &str, channel: &Channel) -> Vec<RuntimeError> {
    let mut errors = Vec::new();
    let mut refuse =
        |message: String| errors.push(RuntimeError::Schema(format!("channel {name}: {message}")));
    if !(1_000..=30_000).contains(&channel.ttl_ms) || channel.ttl_ms % 1_000 != 0 {
        refuse("ttl must be integer seconds from 1 to 30".into());
    }
    if channel.value.is_empty() {
        refuse("value must declare a nonempty closed record".into());
    }
    for (field, kind) in &channel.value {
        if !value_type_valid(schema, kind) {
            refuse(format!("value {field} has an invalid or unsupported type"));
        }
    }
    errors
}

fn value_type_valid(schema: &Schema, kind: &ArgType) -> bool {
    if !kind.bounds_valid() {
        return false;
    }
    match kind {
        ArgType::Cursor | ArgType::Bytes { .. } | ArgType::Image { .. } | ArgType::Video { .. } => {
            false
        }
        ArgType::Optional(inner) => {
            !matches!(inner.as_ref(), ArgType::Optional(_)) && value_type_valid(schema, inner)
        }
        ArgType::List {
            of: Some(inner),
            max,
        } => *max > 0 && value_type_valid(schema, inner),
        ArgType::List { of: None, .. } | ArgType::Scalar => false,
        ArgType::Text { max, .. } => *max > 0,
        ArgType::Json { max_bytes } => *max_bytes > 0,
        ArgType::Ref { table } => schema.tables.contains_key(table),
        ArgType::Enum { variants } => {
            !variants.is_empty()
                && variants
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    == variants.len()
        }
        ArgType::Decimal { scale } => *scale <= 12,
        ArgType::Money { currency, scale } => {
            *scale <= 12 && currency.len() == 3 && currency.bytes().all(|b| b.is_ascii_uppercase())
        }
        _ => true,
    }
}
