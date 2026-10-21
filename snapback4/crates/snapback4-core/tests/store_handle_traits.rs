//! Check the actual non-test library, including macro-generated implementations
//! and `cfg(not(test))` code. The lexical census is an additional fast guard.
// @ref LLP 3000.009.001.000#3.4 — owning handles expose no implicit backend access.
#![cfg(feature = "sqlite")]

use snapback4_core::{store as sqlite, store_port::{AnyStore, AnyTx, ReadSnapshot, AnyInspection}};

// The blanket marker is uniquely inferred only while none of the forbidden
// impls exists. A forbidden impl adds a second marker and makes `_` ambiguous.
// This is the trait-overlap technique used by static_assertions; no dependency.
macro_rules! assert_no_backend_access {
    ($handle:ty) => {
        const _: fn() = || {
            trait Ambiguous<A> { fn absent() {} }
            impl<T: ?Sized> Ambiguous<()> for T {}
            struct DerefEscape;
            impl<T: std::ops::Deref> Ambiguous<DerefEscape> for T {}
            struct DerefMutEscape;
            impl<T: std::ops::DerefMut> Ambiguous<DerefMutEscape> for T {}
            let _ = <$handle as Ambiguous<_>>::absent;
        };
        assert_no_backend_access!(@refs $handle, sqlite::Store);
        assert_no_backend_access!(@refs $handle, sqlite::Tx<'static>);
        assert_no_backend_access!(@refs $handle, sqlite::inspect::Inspection);
        assert_no_backend_access!(@refs $handle, rusqlite::Connection);
        assert_no_backend_access!(@refs $handle, rusqlite::Transaction<'static>);
    };
    (@refs $handle:ty, $backend:ty) => {
        const _: fn() = || {
            trait Ambiguous<A> { fn absent() {} }
            impl<T: ?Sized> Ambiguous<()> for T {}
            struct RefEscape;
            impl<T: AsRef<$backend>> Ambiguous<RefEscape> for T {}
            struct MutEscape;
            impl<T: AsMut<$backend>> Ambiguous<MutEscape> for T {}
            struct BorrowEscape;
            impl<T: std::borrow::Borrow<$backend>> Ambiguous<BorrowEscape> for T {}
            struct BorrowMutEscape;
            impl<T: std::borrow::BorrowMut<$backend>> Ambiguous<BorrowMutEscape> for T {}
            let _ = <$handle as Ambiguous<_>>::absent;
        };
    };
}

assert_no_backend_access!(AnyStore);
assert_no_backend_access!(AnyTx<'static>);
assert_no_backend_access!(ReadSnapshot<'static>);
assert_no_backend_access!(AnyInspection);

#[test]
fn non_test_library_owning_handles_have_no_implicit_backend_access() {
    // The const assertions above are checked before this integration test runs.
}
