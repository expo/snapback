//! Preserve struct/enum field order while rebuilding every map twice from
//! the same entries. Pins guard the typed surface; this independent B-tree
//! serialization guards the collection's representation and nested maps.
use serde::{Serialize, Serializer, ser::*};
use snapback4_core::smallmap::SmallMap;
use std::collections::BTreeMap;
type Error = serde_json::Error;
#[derive(Clone)]
enum Node { Atom(serde_json::Value), Seq(Vec<Node>), Record(Vec<(String, Node)>), Map(Vec<(String, Node)>) }
struct Capture;
struct Seq { items: Vec<Node>, variant: Option<String> }
struct Map { items: Vec<(String, Node)>, key: Option<String>, record: bool, variant: Option<String> }
fn wrapped(variant: Option<String>, node: Node) -> Node { match variant { Some(name) => Node::Record(vec![(name, node)]), None => node } }
macro_rules! atom {
    ($($method:ident: $ty:ty),*) => { $(fn $method(self, value: $ty) -> Result<Node, Error> { Ok(Node::Atom(serde_json::to_value(value)?)) })* };
}
impl Serializer for Capture {
    type Ok = Node; type Error = Error;
    type SerializeSeq = Seq; type SerializeTuple = Seq; type SerializeTupleStruct = Seq; type SerializeTupleVariant = Seq;
    type SerializeMap = Map; type SerializeStruct = Map; type SerializeStructVariant = Map;
    atom!(serialize_bool: bool, serialize_i8: i8, serialize_i16: i16, serialize_i32: i32, serialize_i64: i64, serialize_u8: u8, serialize_u16: u16, serialize_u32: u32, serialize_u64: u64, serialize_f32: f32, serialize_f64: f64, serialize_char: char, serialize_str: &str, serialize_bytes: &[u8]);
    fn serialize_none(self) -> Result<Node, Error> { self.serialize_unit() }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Node, Error> { value.serialize(self) }
    fn serialize_unit(self) -> Result<Node, Error> { Ok(Node::Atom(serde_json::Value::Null)) }
    fn serialize_unit_struct(self, _: &'static str) -> Result<Node, Error> { self.serialize_unit() }
    fn serialize_unit_variant(self, _: &'static str, _: u32, variant: &'static str) -> Result<Node, Error> { self.serialize_str(variant) }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(self, _: &'static str, value: &T) -> Result<Node, Error> { value.serialize(self) }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(self, _: &'static str, _: u32, variant: &'static str, value: &T) -> Result<Node, Error> { Ok(wrapped(Some(variant.into()), value.serialize(self)?)) }
    fn serialize_seq(self, _: Option<usize>) -> Result<Seq, Error> { Ok(Seq { items: vec![], variant: None }) }
    fn serialize_tuple(self, len: usize) -> Result<Seq, Error> { self.serialize_seq(Some(len)) }
    fn serialize_tuple_struct(self, _: &'static str, len: usize) -> Result<Seq, Error> { self.serialize_tuple(len) }
    fn serialize_tuple_variant(self, _: &'static str, _: u32, variant: &'static str, _: usize) -> Result<Seq, Error> { Ok(Seq { items: vec![], variant: Some(variant.into()) }) }
    fn serialize_map(self, _: Option<usize>) -> Result<Map, Error> { Ok(Map { items: vec![], key: None, record: false, variant: None }) }
    fn serialize_struct(self, _: &'static str, _: usize) -> Result<Map, Error> { Ok(Map { items: vec![], key: None, record: true, variant: None }) }
    fn serialize_struct_variant(self, _: &'static str, _: u32, variant: &'static str, _: usize) -> Result<Map, Error> { Ok(Map { items: vec![], key: None, record: true, variant: Some(variant.into()) }) }
}
impl SerializeSeq for Seq {
    type Ok = Node; type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { self.items.push(value.serialize(Capture)?); Ok(()) }
    fn end(self) -> Result<Node, Error> { Ok(wrapped(self.variant, Node::Seq(self.items))) }
}
macro_rules! sequence {
    ($trait:ident, $method:ident) => { impl $trait for Seq { type Ok = Node; type Error = Error;
        fn $method<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { SerializeSeq::serialize_element(self, value) }
        fn end(self) -> Result<Node, Error> { SerializeSeq::end(self) }
    } };
}
sequence!(SerializeTuple, serialize_element); sequence!(SerializeTupleStruct, serialize_field); sequence!(SerializeTupleVariant, serialize_field);
impl SerializeMap for Map {
    type Ok = Node; type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Error> {
        self.key = Some(serde_json::to_value(key)?.as_str().ok_or_else(|| <Error as serde::ser::Error>::custom("identity subject has a non-text map key"))?.to_owned()); Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> { self.items.push((self.key.take().expect("map key"), value.serialize(Capture)?)); Ok(()) }
    fn end(self) -> Result<Node, Error> { Ok(wrapped(self.variant, if self.record { Node::Record(self.items) } else { Node::Map(self.items) })) }
}
impl SerializeStruct for Map {
    type Ok = Node; type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, key: &'static str, value: &T) -> Result<(), Error> { self.items.push((key.into(), value.serialize(Capture)?)); Ok(()) }
    fn end(self) -> Result<Node, Error> { SerializeMap::end(self) }
}
impl SerializeStructVariant for Map {
    type Ok = Node; type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, key: &'static str, value: &T) -> Result<(), Error> { SerializeStruct::serialize_field(self, key, value) }
    fn end(self) -> Result<Node, Error> { SerializeMap::end(self) }
}
struct Ordered<'a>(&'a Node, bool);
impl Serialize for Ordered<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Node::Atom(value) => value.serialize(serializer),
            Node::Seq(items) => serializer.collect_seq(items.iter().map(|value| Ordered(value, self.1))),
            Node::Record(items) => serializer.collect_map(items.iter().map(|(key, value)| (key, Ordered(value, self.1)))),
            Node::Map(items) => {
                // Reverse insertion also tests construction independently of
                // the production collection's already sorted iteration.
                let source = items.iter().rev().map(|(key, value)| (key, Ordered(value, self.1)));
                if self.1 { source.collect::<SmallMap<_, _>>().serialize(serializer) }
                else { source.collect::<BTreeMap<_, _>>().serialize(serializer) }
            }
        }
    }
}
pub fn bytes<T: Serialize + ?Sized>(value: &T) -> Vec<u8> {
    let source = value.serialize(Capture).unwrap();
    let tree = serde_json::to_vec(&Ordered(&source, false)).unwrap();
    let small = serde_json::to_vec(&Ordered(&source, true)).unwrap();
    assert_eq!(tree, small, "BTreeMap/SmallMap JSON differs");
    use sha2::{Digest, Sha256};
    assert_eq!(Sha256::digest(&tree), Sha256::digest(&small));
    assert_eq!(tree, serde_json::to_vec(value).unwrap(), "production differs from independent BTreeMap serialization");
    tree
}
