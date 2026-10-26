//! Supplied replay IDs make campaign populations independent of host entropy.
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — fixture inputs use the existing supplied-ID boundary, never runtime mint overrides.
use super::*;
use std::cell::RefCell;
thread_local! {static CURRENT:RefCell<Option<u128>>=const{RefCell::new(None)};}
pub(super) struct Scope(bool);
impl Scope {pub(super) fn new()->Self{Self(CURRENT.with(|slot|{let mut value=slot.borrow_mut();if value.is_some(){false}else{*value=Some(0);true}}))}}
impl Drop for Scope {fn drop(&mut self){if self.0{CURRENT.with(|slot|{slot.replace(None);});}}}
pub(super) struct Pending {viewer:String,args:BTreeMap<String,Value>}
pub(super) fn context(viewer:impl Into<String>,args:BTreeMap<String,Value>)->Pending{Pending{viewer:viewer.into(),args}}
impl Pending {
 pub(super) fn at(self,now:i64)->Context{
  let context=Context::new(self.viewer,self.args).at(now);
  CURRENT.with(|slot|{
   let mut state=slot.borrow_mut();let Some(last)=state.as_mut()else{return context;};
   // One supplied ID for every write the ordinary mutation meter can admit.
   // Reserving unused IDs is deterministic and never changes authority/data.
   let first=((*last).saturating_add(1)).max((now.max(0) as u128)<<80);
   let count=snapback4_core::meter::Ceilings::default().rows_written as u128;
   *last=first+count;
   context.with_ids((first..first+count).map(|mut value|{
    const ALPHABET:&[u8;32]=b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut bytes=[b'0';26];for byte in bytes.iter_mut().rev(){*byte=ALPHABET[(value&31)as usize];value>>=5;}
    String::from_utf8(bytes.to_vec()).expect("ASCII fixture ID")
   }))
  })
 }
}
