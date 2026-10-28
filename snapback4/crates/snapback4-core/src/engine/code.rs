//! Immutable activated schema/program ownership; edits take an owned copy.
// @ref LLP 3000.036.004.000.000#shared-engine-code — fixtures share code, never mutable worlds or authority.
use std::{ops::{Deref, DerefMut}, sync::Arc};
#[derive(Clone, Debug)]
pub(super) struct Code<T>(Arc<T>);
impl<T> From<T> for Code<T> { fn from(value: T) -> Self { Self(Arc::new(value)) } }
impl<T> Deref for Code<T> { type Target = T; fn deref(&self) -> &T { &self.0 } }
impl<T: Clone> DerefMut for Code<T> { fn deref_mut(&mut self) -> &mut T { Arc::make_mut(&mut self.0) } }
impl<T: serde::Serialize> serde::Serialize for Code<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> { self.0.as_ref().serialize(serializer) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_detach_and_serialized_bytes_are_identical() {
        let original: Code<Vec<u64>> = vec![1, 2].into();
        let mut fork = original.clone(); assert!(Arc::ptr_eq(&original.0, &fork.0));
        fork.push(3); assert!(!Arc::ptr_eq(&original.0, &fork.0));
        assert_eq!(&*original, &[1, 2]); assert_eq!(&*fork, &[1, 2, 3]);
        assert_eq!(serde_json::to_vec(&original).unwrap(), serde_json::to_vec(&*original).unwrap());
    }
}
