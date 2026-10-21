//! Deterministic, locale-independent text transforms used by historical backfills.
use serde::{Deserialize, Serialize};
use crate::{Value, RuntimeError};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Function { Before, After, BeforeLast, AfterLast, StartsWith, AllDigits, NonemptyLines }
impl Function {
    pub fn named(name: &str) -> Option<Self> { Some(match name {
        "before" => Self::Before, "after" => Self::After,
        "beforeLast" => Self::BeforeLast, "afterLast" => Self::AfterLast,
        "startsWith" => Self::StartsWith, "allDigits" => Self::AllDigits, "nonemptyLines"=>Self::NonemptyLines, _ => return None,
    }) }
    pub fn arity(self) -> usize { if matches!(self,Self::AllDigits|Self::NonemptyLines) { 1 } else { 2 } }
    pub fn boolean(self) -> bool { matches!(self, Self::StartsWith | Self::AllDigits) }
    // Missing delimiter: before returns the whole text, after returns empty.
    // Empty delimiter refuses, rather than creating surprising split endpoints.
    pub fn apply(self, args: &[Value]) -> Result<Value, RuntimeError> {
        let text = args[0].as_str()?;
        if self == Self::NonemptyLines {return Ok(Value::Int(text.lines().filter(|line|!line.trim().is_empty()).count() as i64));}
        if self == Self::AllDigits { return Ok(Value::Bool(!text.is_empty() && text.bytes().all(|c|c.is_ascii_digit()))); }
        let delimiter = args[1].as_str()?;
        if self == Self::StartsWith { return Ok(Value::Bool(text.starts_with(delimiter))); }
        if delimiter.is_empty() { return Err(RuntimeError::Input("text split delimiter must not be empty".into())); }
        let pair = if matches!(self, Self::BeforeLast | Self::AfterLast) { text.rsplit_once(delimiter) } else { text.split_once(delimiter) };
        let (before,after) = pair.unwrap_or((text,""));
        Ok(Value::String(if matches!(self, Self::Before | Self::BeforeLast) { before } else { after }.to_owned()))
    }
}
