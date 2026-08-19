//! Sealed authenticated operations over the engine-owned database.
//!
//! A plan can be minted only by auth policy in this crate. The engine may
//! execute it against its private `LocalDatabase`; higher adapters can carry
//! a plan but cannot supply an arbitrary closure or implement the trait.

use snapback_kernel::storage::LocalDatabase;

mod private {
    pub trait Sealed {}
}

#[doc(hidden)]
pub trait AuthDatabasePlan: private::Sealed {
    type Output;

    #[doc(hidden)]
    fn execute(self, database: &mut LocalDatabase) -> Self::Output;
}

pub(crate) struct Plan<F> {
    execute: F,
}

impl<F> private::Sealed for Plan<F> {}

impl<F, Output> AuthDatabasePlan for Plan<F>
where
    F: FnOnce(&mut LocalDatabase) -> Output,
{
    type Output = Output;

    fn execute(self, database: &mut LocalDatabase) -> Self::Output {
        (self.execute)(database)
    }
}

pub(crate) fn plan<F, Output>(execute: F) -> impl AuthDatabasePlan<Output = Output>
where
    F: FnOnce(&mut LocalDatabase) -> Output,
{
    Plan { execute }
}
