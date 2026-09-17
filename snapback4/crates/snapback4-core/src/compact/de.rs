use super::{Error, Kind};
use serde::de::{self, DeserializeSeed, IntoDeserializer, Visitor};

pub(super) struct Deserializer<'de> { input: &'de [u8], depth: usize }
impl<'de> Deserializer<'de> {
    pub fn new(input: &'de [u8]) -> Self { Self { input, depth: 0 } }
    pub fn remaining(&self) -> &'de [u8] { self.input }
    fn take(&mut self, len: usize) -> Result<&'de [u8], Error> {
        if len > self.input.len() { return Err(Error::message("truncated compact input")); }
        let (head, tail) = self.input.split_at(len); self.input = tail; Ok(head)
    }
    fn byte(&mut self) -> Result<u8, Error> { Ok(self.take(1)?[0]) }
    fn marker(&mut self) -> Result<bool, Error> {
        match self.byte()? { 0 => Ok(false), 1 => Ok(true), _ => Err(Error::message("invalid presence or boolean byte")) }
    }
    fn unsigned(&mut self, bits: usize) -> Result<u128, Error> {
        let mut value = 0;
        for shift in (0..bits).step_by(7) {
            let byte = self.byte()?;
            let payload = byte & 127;
            if bits - shift < 7 && payload >= (1 << (bits - shift)) { return Err(Error::message("varint overflow")); }
            value |= u128::from(payload) << shift;
            if byte < 128 {
                if shift != 0 && payload == 0 { return Err(Error::message("noncanonical varint")); }
                return Ok(value);
            }
        }
        Err(Error::message("unterminated varint"))
    }
    fn length(&mut self) -> Result<usize, Error> {
        let len = self.unsigned(usize::BITS as usize)? as usize;
        if len > self.input.len() { return Err(Error::message("length exceeds remaining input")); }
        Ok(len)
    }
    fn nested<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, Error>) -> Result<T, Error> {
        if self.depth >= 128 { return Err(Error::message("compact nesting exceeds 128")); }
        self.depth += 1;
        let result = f(self);
        self.depth -= 1;
        result
    }
    fn sequence<V: Visitor<'de>>(&mut self, len: usize, fields: bool, visitor: V) -> Result<V::Value, Error> {
        if fields && len == 0 && self.byte()? != 0 { return Err(Error::message("invalid empty struct")); }
        self.nested(|decoder| {
            let mut access = Sequence { decoder, remaining: len, fields };
            let value = visitor.visit_seq(&mut access)?;
            // Struct field names include aliases; only the visitor knows the positional count.
            if !fields && access.remaining != 0 { return Err(Error::message("unconsumed sequence elements")); }
            Ok(value)
        })
    }
}

macro_rules! integer {
    ($method:ident, $visit:ident, $ty:ty, unsigned) => {
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> { visitor.$visit(self.unsigned(<$ty>::BITS as usize)? as $ty) }
    };
    ($method:ident, $visit:ident, $ty:ty, signed) => {
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
            let n = self.unsigned(<$ty>::BITS as usize)?;
            visitor.$visit(((n >> 1) as i128 ^ -((n & 1) as i128)) as $ty)
        }
    };
}
impl<'de> de::Deserializer<'de> for &mut Deserializer<'de> {
    type Error = Error;
    fn is_human_readable(&self) -> bool { false }
    fn deserialize_any<V: Visitor<'de>>(self, _: V) -> Result<V::Value, Error> { Err(Error::message("compact requires a known type")) }
    fn deserialize_bool<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { v.visit_bool(self.marker()?) }
    integer!(deserialize_i8, visit_i8, i8, signed);
    integer!(deserialize_i16, visit_i16, i16, signed);
    integer!(deserialize_i32, visit_i32, i32, signed);
    integer!(deserialize_i64, visit_i64, i64, signed);
    integer!(deserialize_i128, visit_i128, i128, signed);
    integer!(deserialize_u8, visit_u8, u8, unsigned);
    integer!(deserialize_u16, visit_u16, u16, unsigned);
    integer!(deserialize_u32, visit_u32, u32, unsigned);
    integer!(deserialize_u64, visit_u64, u64, unsigned);
    integer!(deserialize_u128, visit_u128, u128, unsigned);
    fn deserialize_f32<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { v.visit_f32(f32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn deserialize_f64<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { v.visit_f64(f64::from_le_bytes(self.take(8)?.try_into().unwrap())) }
    fn deserialize_char<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> {
        let len = self.length()?;
        let text = std::str::from_utf8(self.take(len)?).map_err(|_| Error::message("invalid UTF-8"))?;
        let mut chars = text.chars();
        let ch = chars.next().ok_or_else(|| Error::message("empty character"))?;
        if chars.next().is_some() { return Err(Error::message("multiple characters")); }
        v.visit_char(ch)
    }
    fn deserialize_str<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> {
        let len = self.length()?;
        v.visit_borrowed_str(std::str::from_utf8(self.take(len)?).map_err(|_| Error::message("invalid UTF-8"))?)
    }
    fn deserialize_string<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { self.deserialize_str(v) }
    fn deserialize_bytes<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { let len = self.length()?; v.visit_borrowed_bytes(self.take(len)?) }
    fn deserialize_byte_buf<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { self.deserialize_bytes(v) }
    fn deserialize_option<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> {
        if self.marker()? { self.nested(|d| v.visit_some(d)) } else { v.visit_none() }
    }
    fn deserialize_unit<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> {
        if self.byte()? != 0 { return Err(Error::message("invalid unit")); } v.visit_unit()
    }
    fn deserialize_unit_struct<V: Visitor<'de>>(self, _: &'static str, v: V) -> Result<V::Value, Error> { self.deserialize_unit(v) }
    fn deserialize_newtype_struct<V: Visitor<'de>>(self, _: &'static str, v: V) -> Result<V::Value, Error> { self.nested(|d| v.visit_newtype_struct(d)) }
    fn deserialize_seq<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> { let len = self.length()?; self.sequence(len, false, v) }
    fn deserialize_tuple<V: Visitor<'de>>(self, len: usize, v: V) -> Result<V::Value, Error> {
        if len == 0 && self.byte()? != 0 { return Err(Error::message("invalid empty tuple")); }
        self.sequence(len, false, v)
    }
    fn deserialize_tuple_struct<V: Visitor<'de>>(self, _: &'static str, len: usize, v: V) -> Result<V::Value, Error> { self.deserialize_tuple(len, v) }
    fn deserialize_map<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Error> {
        let len = self.length()?;
        self.nested(|decoder| {
            let mut map = Map { decoder, remaining: len, value_pending: false };
            let value = v.visit_map(&mut map)?;
            if map.remaining != 0 || map.value_pending { return Err(Error::message("unconsumed map entries")); }
            Ok(value)
        })
    }
    fn deserialize_struct<V: Visitor<'de>>(self, _: &'static str, fields: &'static [&'static str], v: V) -> Result<V::Value, Error> { self.sequence(fields.len(), true, v) }
    fn deserialize_enum<V: Visitor<'de>>(self, _: &'static str, variants: &'static [&'static str], v: V) -> Result<V::Value, Error> {
        let index = self.unsigned(32)? as u32;
        if index as usize >= variants.len() { return Err(Error::message("invalid variant index")); }
        self.nested(|decoder| v.visit_enum(Enum { decoder, index }))
    }
    serde::forward_to_deserialize_any! { identifier ignored_any }
}

struct Sequence<'a, 'de> { decoder: &'a mut Deserializer<'de>, remaining: usize, fields: bool }
impl<'de> de::SeqAccess<'de> for &mut Sequence<'_, 'de> {
    type Error = Error;
    fn next_element_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<Option<T::Value>, Error> {
        if self.remaining == 0 { return Ok(None); }
        self.remaining -= 1;
        if self.fields && !self.decoder.marker()? {
            return match seed.deserialize(Absent) { Ok(value) => Ok(Some(value)), Err(Error(Kind::Absent)) => Ok(None), Err(error) => Err(error) };
        }
        seed.deserialize(&mut *self.decoder).map(Some)
    }
    fn size_hint(&self) -> Option<usize> { Some(self.remaining.min(self.decoder.input.len())) }
}
struct Absent;
impl<'de> de::Deserializer<'de> for Absent {
    type Error = Error;
    fn is_human_readable(&self) -> bool { false }
    fn deserialize_any<V: Visitor<'de>>(self, _: V) -> Result<V::Value, Error> { Err(Error(Kind::Absent)) }
    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> { visitor.visit_none() }
    serde::forward_to_deserialize_any! { bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit unit_struct newtype_struct seq tuple tuple_struct map struct enum identifier ignored_any }
}
struct Map<'a, 'de> { decoder: &'a mut Deserializer<'de>, remaining: usize, value_pending: bool }
impl<'de> de::MapAccess<'de> for &mut Map<'_, 'de> {
    type Error = Error;
    fn next_key_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<Option<T::Value>, Error> {
        if self.value_pending { return Err(Error::message("map value missing")); }
        if self.remaining == 0 { return Ok(None); }
        self.remaining -= 1; self.value_pending = true;
        seed.deserialize(&mut *self.decoder).map(Some)
    }
    fn next_value_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<T::Value, Error> {
        if !self.value_pending { return Err(Error::message("map key missing")); }
        self.value_pending = false;
        seed.deserialize(&mut *self.decoder)
    }
    fn size_hint(&self) -> Option<usize> { Some(self.remaining.min(self.decoder.input.len())) }
}
struct Enum<'a, 'de> { decoder: &'a mut Deserializer<'de>, index: u32 }
impl<'a, 'de> de::EnumAccess<'de> for Enum<'a, 'de> {
    type Error = Error;
    type Variant = Self;
    fn variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<(T::Value, Self), Error> { Ok((seed.deserialize(self.index.into_deserializer())?, self)) }
}
impl<'de> de::VariantAccess<'de> for Enum<'_, 'de> {
    type Error = Error;
    fn unit_variant(self) -> Result<(), Error> { Ok(()) }
    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<T::Value, Error> { seed.deserialize(self.decoder) }
    fn tuple_variant<V: Visitor<'de>>(self, len: usize, v: V) -> Result<V::Value, Error> { de::Deserializer::deserialize_tuple(self.decoder, len, v) }
    fn struct_variant<V: Visitor<'de>>(self, fields: &'static [&'static str], v: V) -> Result<V::Value, Error> { self.decoder.sequence(fields.len(), true, v) }
}
