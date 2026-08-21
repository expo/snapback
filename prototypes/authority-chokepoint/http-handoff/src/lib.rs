//! Throwaway Axum 0.8.9 proof for LLP 0293 section 10.3.
//!
//! This models the real server topology: async policy middleware prepares an
//! exact operation, calls `Next::run(Request<Body>)`, and a typed handler
//! extracts and consumes the operation. It is not a Snapback implementation.

#![allow(dead_code)]

use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use std::{
    collections::HashMap,
    marker::PhantomData,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

mod kernel {
    use super::PhantomData;

    pub(super) struct QueryKind;

    /// Synthetic stand-in for the exact opaque kernel result.
    ///
    /// There is deliberately no `Clone`, public constructor, conversion,
    /// default, serde implementation, or field visibility.
    pub(super) struct PreparedOperation<Kind> {
        operation_id: u64,
        _kind: PhantomData<fn() -> Kind>,
    }

    pub(super) fn prepare_query(operation_id: u64) -> PreparedOperation<QueryKind> {
        PreparedOperation {
            operation_id,
            _kind: PhantomData,
        }
    }

    impl PreparedOperation<QueryKind> {
        pub(super) fn consume(self) -> u64 {
            self.operation_id
        }
    }
}

use kernel::{PreparedOperation, QueryKind};

/// The only cloneable value stored in `http::Extensions`.
///
/// Cloning this type duplicates a pointer to one mutex-protected slot. It does
/// not duplicate `T`, and `T` does not need to be `Clone` or `Sync`.
struct TakeOnce<T> {
    inner: Arc<Mutex<Option<T>>>,
}

impl<T> TakeOnce<T> {
    fn new(value: T) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some(value))),
        }
    }

    fn take(&self) -> Result<T, TakeOnceError> {
        let mut guard = self.inner.lock().map_err(|_| TakeOnceError::Poisoned)?;
        guard.take().ok_or(TakeOnceError::AlreadyTaken)
    }
}

impl<T> Clone for TakeOnce<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TakeOnceError {
    AlreadyTaken,
    Poisoned,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TakeRejection {
    Missing,
    AlreadyTaken,
    Poisoned,
}

impl IntoResponse for TakeRejection {
    fn into_response(self) -> Response {
        // Missing, stolen-by-an-earlier-consumer, and poisoned state all fail
        // closed. A real implementation would use one registered internal
        // diagnostic while preserving this non-enumerating response posture.
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "prepared operation unavailable",
        )
            .into_response()
    }
}

/// The handler extractor returns the move-only operation itself, not a slot.
struct TakenQueryOperation(PreparedOperation<QueryKind>);

impl<S> FromRequestParts<S> for TakenQueryOperation
where
    S: Send + Sync,
{
    type Rejection = TakeRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let slot = parts
            .extensions
            .get::<TakeOnce<PreparedOperation<QueryKind>>>()
            .ok_or(TakeRejection::Missing)?;
        slot.take().map(Self).map_err(|error| match error {
            TakeOnceError::AlreadyTaken => TakeRejection::AlreadyTaken,
            TakeOnceError::Poisoned => TakeRejection::Poisoned,
        })
    }
}

/// A typed kernel-side registry is also ownership-correct, but much broader.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct OpaqueOperationId(u64);

struct TypedRegistry<T> {
    next_id: AtomicU64,
    entries: Mutex<HashMap<OpaqueOperationId, T>>,
}

impl<T> TypedRegistry<T> {
    fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn park(&self, value: T) -> Result<OpaqueOperationId, TakeOnceError> {
        let id = OpaqueOperationId(self.next_id.fetch_add(1, Ordering::Relaxed));
        self.entries
            .lock()
            .map_err(|_| TakeOnceError::Poisoned)?
            .insert(id, value);
        Ok(id)
    }

    fn take(&self, id: OpaqueOperationId) -> Result<T, TakeOnceError> {
        self.entries
            .lock()
            .map_err(|_| TakeOnceError::Poisoned)?
            .remove(&id)
            .ok_or(TakeOnceError::AlreadyTaken)
    }
}

/// Passing the operation through the handler's own call path is valid when
/// preparation and execution have the same async owner.
async fn direct_handler_path(operation_id: u64) -> u64 {
    let operation = kernel::prepare_query(operation_id);
    tokio::task::yield_now().await;
    exact_handler(operation).await
}

async fn exact_handler(operation: PreparedOperation<QueryKind>) -> u64 {
    tokio::task::yield_now().await;
    operation.consume()
}

#[cfg(feature = "negative-direct-extension")]
fn direct_move_only_extension_does_not_compile(operation: PreparedOperation<QueryKind>) {
    let mut extensions = axum::http::Extensions::new();
    extensions.insert(operation);
}

#[cfg(feature = "negative-next-side-channel")]
async fn next_has_no_side_channel(
    request: axum::extract::Request,
    next: axum::middleware::Next,
    operation: PreparedOperation<QueryKind>,
) -> Response {
    next.run(request, operation).await
}

#[cfg(feature = "negative-request-body-owner")]
struct RequestOwner<B, T> {
    body: B,
    operation: T,
}

#[cfg(feature = "negative-request-body-owner")]
async fn next_requires_the_framework_body_type(
    request: axum::http::Request<RequestOwner<axum::body::Body, PreparedOperation<QueryKind>>>,
    next: axum::middleware::Next,
) -> Response {
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, header::HeaderValue},
        middleware::{self, Next},
        response::Response,
        routing::get,
    };
    use tower::ServiceExt;

    async fn take_query(TakenQueryOperation(operation): TakenQueryOperation) -> String {
        // This detached task proves that after extraction the same move-only
        // operation crosses the server's real Send + 'static boundary.
        tokio::spawn(async move {
            tokio::task::yield_now().await;
            operation.consume()
        })
        .await
        .expect("detached operation consumer panicked")
        .to_string()
    }

    async fn prepare_query_middleware(mut request: Request<Body>, next: Next) -> Response {
        let slot = TakeOnce::new(kernel::prepare_query(41));
        request.extensions_mut().insert(slot.clone());

        let mut response = next.run(request).await;
        let second_take_failed_closed = matches!(slot.take(), Err(TakeOnceError::AlreadyTaken));
        response.headers_mut().insert(
            "x-prototype-second-take",
            HeaderValue::from_static(if second_take_failed_closed {
                "failed-closed"
            } else {
                "ownership-broken"
            }),
        );
        response
    }

    #[tokio::test]
    async fn move_once_slot_crosses_real_axum_next_and_detached_task() {
        let app = Router::new()
            .route("/proof", get(take_query))
            .layer(middleware::from_fn(prepare_query_middleware));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/proof")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["x-prototype-second-take"],
            "failed-closed"
        );
        let body = to_bytes(response.into_body(), 64).await.unwrap();
        assert_eq!(&body[..], b"41");
    }

    #[test]
    fn explicit_second_take_fails_closed() {
        let slot = TakeOnce::new(kernel::prepare_query(7));
        let first = slot.take().expect("first take must succeed");
        assert_eq!(first.consume(), 7);
        assert!(matches!(slot.take(), Err(TakeOnceError::AlreadyTaken)));
    }

    #[tokio::test]
    async fn concurrent_takers_cannot_duplicate_the_operation() {
        let slot = TakeOnce::new(kernel::prepare_query(11));
        let contender = slot.clone();
        let first = tokio::spawn(async move { slot.take() });
        let second = tokio::spawn(async move { contender.take() });
        let results = [first.await.unwrap(), second.await.unwrap()];

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(TakeOnceError::AlreadyTaken)))
                .count(),
            1
        );
    }

    #[test]
    fn typed_registry_remove_is_also_single_owner() {
        let registry = TypedRegistry::new();
        let id = registry.park(kernel::prepare_query(13)).unwrap();
        assert_eq!(registry.take(id).unwrap().consume(), 13);
        assert!(matches!(
            registry.take(id),
            Err(TakeOnceError::AlreadyTaken)
        ));
    }

    #[tokio::test]
    async fn direct_handler_call_path_is_single_owner() {
        assert_eq!(direct_handler_path(17).await, 17);
    }
}
