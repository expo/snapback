//! Shared finite service-authority terminal value shapes.
//!
//! @ref LLP 0225#1-ownership-map — kernel-consumed value shapes are leaf-owned;
//!   the auth crate keeps process-fence witnesses beside the behavior that
//!   constructs and acts on them.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceAuthorityDisposition {
    Carrier,
    DurableDelete,
}
