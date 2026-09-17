use super::Error;
use serde::{Serialize, ser};

pub(super) struct Serializer(pub Vec<u8>);
impl Serializer {
    fn unsigned(&mut self, mut value: u128) {
        while value >= 128 { self.0.push(value as u8 | 128); value >>= 7; }
        self.0.push(value as u8);
    }
}
impl<'a> ser::Serializer for &'a mut Serializer {
    type Ok = ();
    type Error = Error;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Fields<'a>;
    type SerializeStructVariant = Fields<'a>;
    fn is_human_readable(&self) -> bool { false }
    fn serialize_bool(self, value: bool) -> Result<(), Error> { self.0.push(u8::from(value)); Ok(()) }
    fn serialize_i8(self, value: i8) -> Result<(), Error> { self.serialize_i128(value.into()) }
    fn serialize_i16(self, value: i16) -> Result<(), Error> { self.serialize_i128(value.into()) }
    fn serialize_i32(self, value: i32) -> Result<(), Error> { self.serialize_i128(value.into()) }
    fn serialize_i64(self, value: i64) -> Result<(), Error> { self.serialize_i128(value.into()) }
    fn serialize_i128(self, value: i128) -> Result<(), Error> { self.unsigned(((value as u128) << 1) ^ ((value >> 127) as u128)); Ok(()) }
    fn serialize_u8(self, value: u8) -> Result<(), Error> { self.serialize_u128(value.into()) }
    fn serialize_u16(self, value: u16) -> Result<(), Error> { self.serialize_u128(value.into()) }
    fn serialize_u32(self, value: u32) -> Result<(), Error> { self.serialize_u128(value.into()) }
    fn serialize_u64(self, value: u64) -> Result<(), Error> { self.serialize_u128(value.into()) }
    fn serialize_u128(self, value: u128) -> Result<(), Error> { self.unsigned(value); Ok(()) }
    fn serialize_f32(self, value: f32) -> Result<(), Error> { self.0.extend(value.to_le_bytes()); Ok(()) }
    fn serialize_f64(self, value: f64) -> Result<(), Error> { self.0.extend(value.to_le_bytes()); Ok(()) }
    fn serialize_char(self, value: char) -> Result<(), Error> { self.serialize_str(value.encode_utf8(&mut [0; 4])) }
    fn serialize_str(self, value: &str) -> Result<(), Error> { self.serialize_bytes(value.as_bytes()) }
    fn serialize_bytes(self, value: &[u8]) -> Result<(), Error> { self.unsigned(value.len() as u128); self.0.extend(value); Ok(()) }
    fn serialize_none(self) -> Result<(), Error> { self.serialize_bool(false) }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<(), Error> { self.serialize_bool(true)?; value.serialize(self) }
    fn serialize_unit(self) -> Result<(), Error> { self.0.push(0); Ok(()) }
    fn serialize_unit_struct(self, _: &'static str) -> Result<(), Error> { self.serialize_unit() }
    fn serialize_unit_variant(self, _: &'static str, index: u32, _: &'static str) -> Result<(), Error> { self.serialize_u32(index) }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(self, _: &'static str, value: &T) -> Result<(), Error> { value.serialize(self) }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(self, _: &'static str, index: u32, _: &'static str, value: &T) -> Result<(), Error> { self.serialize_u32(index)?; value.serialize(self) }
    fn serialize_seq(self, len: Option<usize>) -> Result<Self, Error> { self.unsigned(len.ok_or_else(|| Error::message("sequence needs a length"))? as u128); Ok(self) }
    fn serialize_tuple(self, len: usize) -> Result<Self, Error> { if len == 0 { self.serialize_unit()?; } Ok(self) }
    fn serialize_tuple_struct(self, _: &'static str, len: usize) -> Result<Self, Error> { self.serialize_tuple(len) }
    fn serialize_tuple_variant(self, _: &'static str, index: u32, _: &'static str, len: usize) -> Result<Self, Error> { self.serialize_u32(index)?; self.serialize_tuple(len) }
    fn serialize_map(self, len: Option<usize>) -> Result<Self, Error> { self.serialize_seq(len) }
    // `len` counts present fields; skip_field supplies the omitted positions.
    fn serialize_struct(self, _: &'static str, _: usize) -> Result<Fields<'a>, Error> { Ok(Fields { serializer: self, count: 0 }) }
    fn serialize_struct_variant(self, _: &'static str, index: u32, _: &'static str, _: usize) -> Result<Fields<'a>, Error> { self.serialize_u32(index)?; Ok(Fields { serializer: self, count: 0 }) }
}
impl ser::SerializeSeq for &mut Serializer {
    type Ok = (); type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { value.serialize(&mut **self) }
    fn end(self) -> Result<(), Error> { Ok(()) }
}
impl ser::SerializeTuple for &mut Serializer {
    type Ok = (); type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { value.serialize(&mut **self) }
    fn end(self) -> Result<(), Error> { Ok(()) }
}
impl ser::SerializeTupleStruct for &mut Serializer {
    type Ok = (); type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { value.serialize(&mut **self) }
    fn end(self) -> Result<(), Error> { Ok(()) }
}
impl ser::SerializeTupleVariant for &mut Serializer {
    type Ok = (); type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { value.serialize(&mut **self) }
    fn end(self) -> Result<(), Error> { Ok(()) }
}
impl ser::SerializeMap for &mut Serializer {
    type Ok = (); type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { value.serialize(&mut **self) }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { value.serialize(&mut **self) }
    fn end(self) -> Result<(), Error> { Ok(()) }
}
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — an explicit absence preserves the derive's field positions and declared defaults.
pub(super) struct Fields<'a> { serializer: &'a mut Serializer, count: usize }
impl Fields<'_> {
    fn field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { self.count += 1; self.serializer.0.push(1); value.serialize(&mut *self.serializer) }
    fn absent(&mut self) { self.count += 1; self.serializer.0.push(0); }
    fn finish(self) -> Result<(), Error> {
        // Even an empty struct occupies one byte: sequence lengths can always
        // be checked against the input before their visitor reserves capacity.
        if self.count == 0 { self.serializer.0.push(0); }
        Ok(())
    }
}
impl ser::SerializeStruct for Fields<'_> {
    type Ok = (); type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, _: &'static str, value: &T) -> Result<(), Error> { self.field(value) }
    fn skip_field(&mut self, _: &'static str) -> Result<(), Error> { self.absent(); Ok(()) }
    fn end(self) -> Result<(), Error> { self.finish() }
}
impl ser::SerializeStructVariant for Fields<'_> {
    type Ok = (); type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, _: &'static str, value: &T) -> Result<(), Error> { self.field(value) }
    fn skip_field(&mut self, _: &'static str) -> Result<(), Error> { self.absent(); Ok(()) }
    fn end(self) -> Result<(), Error> { self.finish() }
}
