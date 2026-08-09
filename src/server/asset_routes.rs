use super::*;

// ---------------------------------------------------------------------------
// Asset upload sessions (LLP 0044; tickets L1-04/L1-05).
// ---------------------------------------------------------------------------

pub(super) const TUS_RESUMABLE_HEADER: &str = "tus-resumable";
pub(super) const TUS_VERSION_HEADER: &str = "tus-version";
pub(super) const TUS_EXTENSION_HEADER: &str = "tus-extension";
pub(super) const TUS_CHECKSUM_ALGORITHM_HEADER: &str = "tus-checksum-algorithm";
const TUS_EXTENSIONS_SUPPORTED: &str = "creation,expiration,checksum,termination";
pub(super) const SNAPBACK_MAX_CHUNK_BYTES_HEADER: &str = "snapback-max-chunk-bytes";
pub(super) const TUS_UPLOAD_OFFSET_HEADER: &str = "upload-offset";
pub(super) const TUS_UPLOAD_LENGTH_HEADER: &str = "upload-length";
pub(super) const TUS_UPLOAD_EXPIRES_MS_HEADER: &str = "upload-expires-ms";
pub(super) const TUS_UPLOAD_CHECKSUM_HEADER: &str = "upload-checksum";
const TUS_CONTENT_TYPE: &str = "application/offset+octet-stream";

pub(super) fn require_tus_version(headers: &HeaderMap) -> Result<(), ApiError> {
    let version = headers
        .get(TUS_RESUMABLE_HEADER)
        .and_then(|value| value.to_str().ok());
    if version != Some(crate::assets::ASSET_TUS_VERSION) {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_ASSET_TUS_VERSION_UNSUPPORTED",
            "assets",
            format!(
                "this lane speaks TUS {} only",
                crate::assets::ASSET_TUS_VERSION
            ),
        )));
    }
    Ok(())
}

pub(super) fn tus_response_headers(
    response: &mut Response,
    attempt: &crate::assets::AssetAttemptRecordV1,
) {
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static(TUS_RESUMABLE_HEADER),
        HeaderValue::from_static(crate::assets::ASSET_TUS_VERSION),
    );
    if let Ok(offset) = HeaderValue::from_str(&attempt.acknowledged_offset.to_string()) {
        headers.insert(HeaderName::from_static(TUS_UPLOAD_OFFSET_HEADER), offset);
    }
    if let Ok(length) = HeaderValue::from_str(&attempt.declared_length.to_string()) {
        headers.insert(HeaderName::from_static(TUS_UPLOAD_LENGTH_HEADER), length);
    }
    // Capability advertisement on every TUS response (LLP 0139
    // limits-discoverability finding): say on the wire what the lane
    // implements. Tus-Max-Size is deliberately absent — uploads are created
    // through the admission route where the intent's maxBytes refuses, so
    // no single global creation bound exists; the chunk fact rides the
    // Snapback header beside the standard trio.
    headers.insert(
        HeaderName::from_static(TUS_VERSION_HEADER),
        HeaderValue::from_static(crate::assets::ASSET_TUS_VERSION),
    );
    headers.insert(
        HeaderName::from_static(TUS_EXTENSION_HEADER),
        HeaderValue::from_static(TUS_EXTENSIONS_SUPPORTED),
    );
    headers.insert(
        HeaderName::from_static(TUS_CHECKSUM_ALGORITHM_HEADER),
        HeaderValue::from_static("sha256"),
    );
    if let Ok(chunk) = HeaderValue::from_str(&crate::assets::ASSET_MAX_CHUNK_BYTES.to_string()) {
        headers.insert(
            HeaderName::from_static(SNAPBACK_MAX_CHUNK_BYTES_HEADER),
            chunk,
        );
    }
    if let Ok(expires) = HeaderValue::from_str(&attempt.expires_at_ms.to_string()) {
        headers.insert(
            HeaderName::from_static(TUS_UPLOAD_EXPIRES_MS_HEADER),
            expires,
        );
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

pub(super) async fn asset_attempt_create_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    input: Result<Json<crate::assets::AssetAttemptCreateRequestV1>, JsonRejection>,
) -> Result<Json<crate::assets::AssetAttemptCreateResponseV1>, ApiError> {
    let Json(request) = input.map_err(ApiError::from_json_rejection)?;
    let response = with_snapback(&state, move |snapback| {
        snapback.asset_attempt_create(&authority, request)
    })
    .await?;
    Ok(Json(response))
}

pub(super) async fn asset_attempt_inspect_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
) -> Result<Json<crate::assets::AssetTaskStateV1>, ApiError> {
    let task = with_snapback(&state, move |snapback| {
        snapback.asset_attempt_inspect(&authority, &id)
    })
    .await?;
    Ok(Json(task))
}

pub(super) async fn asset_record_inspect_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let record = with_snapback(&state, move |snapback| {
        snapback.asset_record_inspect(&authority, &id)
    })
    .await?;
    Ok(Json(record))
}

pub(super) async fn asset_attempt_cancel_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
    input: Result<Json<crate::assets::AssetAttemptCancelRequestV1>, JsonRejection>,
) -> Result<Json<crate::assets::AssetTaskStateV1>, ApiError> {
    let Json(request) = input.map_err(ApiError::from_json_rejection)?;
    if request.attempt_id != id {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
            "assets",
            "the cancel body names a different attempt than the route",
        )));
    }
    let task = with_snapback(&state, move |snapback| {
        snapback.asset_attempt_cancel(&authority, request)
    })
    .await?;
    Ok(Json(task))
}

pub(super) async fn asset_attempt_finalize_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
    input: Result<Json<crate::assets::AssetFinalizeRequestV1>, JsonRejection>,
) -> Result<Json<crate::assets::AssetFinalizeResponseV1>, ApiError> {
    let Json(request) = input.map_err(ApiError::from_json_rejection)?;
    if request.attempt_id != id {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
            "assets",
            "the finalize body names a different attempt than the route",
        )));
    }
    let response = with_snapback(&state, move |snapback| {
        snapback.asset_attempt_finalize(&authority, request)
    })
    .await?;
    Ok(Json(response))
}

pub(super) async fn asset_tus_head_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_tus_version(&headers)?;
    let attempt = with_snapback(&state, move |snapback| {
        snapback.asset_tus_head(&authority, &id)
    })
    .await?;
    let mut response = StatusCode::OK.into_response();
    tus_response_headers(&mut response, &attempt);
    Ok(response)
}

pub(super) async fn asset_tus_patch_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    require_tus_version(&headers)?;
    // The chunk bound is enforced here as a classified diagnostic rather
    // than by an extractor layer, whose plain 413 the reviewed-response
    // classifier would truthfully report as an unclassified 500.
    let body = to_bytes(
        body,
        crate::assets::ASSET_MAX_CHUNK_BYTES as usize + 16 * 1024,
    )
    .await
    .map_err(|_| {
        ApiError::from(
            SnapbackError::error(
                "SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED",
                "assets",
                "the TUS chunk exceeds the declared maximum chunk size",
            )
            .with_details(json!({
                "maxChunkBytes": crate::assets::ASSET_MAX_CHUNK_BYTES,
            })),
        )
    })?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if content_type != TUS_CONTENT_TYPE {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_ASSET_TUS_CONTENT_TYPE_UNSUPPORTED",
            "assets",
            format!("TUS PATCH requires content type {TUS_CONTENT_TYPE}"),
        )));
    }
    let offset: u64 = headers
        .get(TUS_UPLOAD_OFFSET_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| {
            ApiError::from(SnapbackError::error(
                "SNAPBACK_ASSET_OFFSET_CONFLICT",
                "assets",
                "TUS PATCH requires a numeric Upload-Offset header",
            ))
        })?;
    // `Upload-Checksum: <algorithm> <base64>` (TUS checksum extension).
    let checksum_header = headers
        .get(TUS_UPLOAD_CHECKSUM_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let attempt = with_snapback(&state, move |snapback| {
        let checksum = checksum_header.as_deref().map(|value| {
            let mut parts = value.splitn(2, ' ');
            (
                parts.next().unwrap_or_default(),
                parts.next().unwrap_or_default(),
            )
        });
        snapback.asset_tus_patch(&authority, &id, offset, body.as_ref(), checksum)
    })
    .await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    tus_response_headers(&mut response, &attempt);
    Ok(response)
}

pub(super) async fn asset_tus_delete_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_tus_version(&headers)?;
    with_snapback(&state, move |snapback| {
        snapback.asset_tus_terminate(&authority, &id)
    })
    .await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        HeaderName::from_static(TUS_RESUMABLE_HEADER),
        HeaderValue::from_static(crate::assets::ASSET_TUS_VERSION),
    );
    Ok(response)
}

/// Strict delivery: every ordinary and range request re-authorizes; the
/// response carries trusted record facts only (never client declarations)
/// and `private, no-store` so authorized bytes are never cached past the
/// authorization that produced them (LLP 0044 §Delivery profiles).
pub(super) async fn asset_deliver_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path((id, variant)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let range_header = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    // The declarative best-variant bound (LLP 0044): `best?maxWidth=N`.
    let max_width = query
        .get("maxWidth")
        .and_then(|value| value.parse::<u64>().ok());
    // Bounded on-demand widths (LLP 0044 §Ceremony floor): `?width=N`
    // ladder-normalizes and materializes once, after authorization.
    let width = query
        .get("width")
        .and_then(|value| value.parse::<u64>().ok());
    let outcome = with_snapback(&state, move |snapback| {
        snapback.asset_deliver(
            &authority,
            &id,
            &variant,
            range_header.as_deref(),
            max_width,
            width,
        )
    })
    .await?;
    stream_asset_delivery(outcome).await
}

/// Shared byte-window → HTTP response tail for every delivery profile; the
/// cache posture rides on the resolved delivery itself.
pub(super) async fn stream_asset_delivery(
    outcome: crate::local::AssetDeliveryOutcome,
) -> Result<Response, ApiError> {
    let delivery = match outcome {
        crate::local::AssetDeliveryOutcome::Unsatisfiable { total_length } => {
            let mut response = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
            response.headers_mut().insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes */{total_length}"))
                    .map_err(|_| ApiError::from(asset_delivery_header_error()))?,
            );
            return Ok(response);
        }
        crate::local::AssetDeliveryOutcome::Content(delivery) => delivery,
    };

    // Store-agnostic streaming: bounded chunk reads through the AssetStore
    // seam, off the async runtime via spawn_blocking (fs today, ranged S3
    // GETs on an object store).
    let store = delivery.store.clone();
    let blob_key = delivery.blob_key.clone();
    let stream = futures_util::stream::try_unfold(
        (
            store,
            blob_key,
            delivery.window_start,
            delivery.window_length,
        ),
        |(store, blob_key, position, remaining)| async move {
            if remaining == 0 {
                return Ok(None);
            }
            let take = remaining.min(crate::assets::ASSET_DELIVERY_CHUNK_BYTES as u64) as usize;
            let (chunk, store, blob_key) = tokio::task::spawn_blocking(move || {
                let chunk = store.read_chunk(
                    crate::assets_store::AssetObjectRef::Blob(&blob_key),
                    position,
                    take,
                );
                (chunk, store, blob_key)
            })
            .await
            .map_err(|error| std::io::Error::other(format!("stream task failed: {error}")))?;
            let chunk = chunk.map_err(|error| std::io::Error::other(error.to_string()))?;
            if chunk.is_empty() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "blob object shorter than its record",
                ));
            }
            let read = chunk.len() as u64;
            let (position, remaining) = advance_asset_delivery_window(position, remaining, read)?;
            Ok(Some((
                Bytes::from(chunk),
                (store, blob_key, position, remaining),
            )))
        },
    );

    let status = if delivery.partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, &delivery.content_type)
        .header(header::CONTENT_LENGTH, delivery.window_length)
        .header(header::ETAG, &delivery.etag)
        .header(header::CACHE_CONTROL, &delivery.cache_control)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_DISPOSITION, &delivery.disposition);
    if delivery.partial {
        let end = delivery.window_start + delivery.window_length - 1;
        builder = builder.header(
            header::CONTENT_RANGE,
            format!(
                "bytes {}-{}/{}",
                delivery.window_start, end, delivery.total_length
            ),
        );
    }
    builder
        .body(Body::from_stream(stream))
        .map_err(|_| ApiError::from(asset_delivery_header_error()))
}

pub(super) fn advance_asset_delivery_window(
    position: u64,
    remaining: u64,
    read: u64,
) -> std::io::Result<(u64, u64)> {
    if read > remaining {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "asset store returned more bytes than the delivery window",
        ));
    }
    let position = position.checked_add(read).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "asset delivery position overflowed",
        )
    })?;
    Ok((position, remaining - read))
}

pub(super) async fn asset_signed_url_issue_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
    Json(request): Json<crate::assets::AssetSignedUrlIssueRequestV1>,
) -> Result<Json<crate::assets::AssetSignedUrlIssueResponseV1>, ApiError> {
    let response = with_snapback(&state, move |snapback| {
        snapback.asset_signed_url_issue(&authority, &id, request)
    })
    .await?;
    Ok(Json(response))
}

pub(super) async fn asset_deliver_signed_route(
    State(state): State<SharedSnapback>,
    Path((id, variant)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let token = query.get("token").cloned().ok_or_else(|| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_ASSET_SIGNATURE_INVALID",
            "assets",
            "the signed URL does not validate",
        ))
    })?;
    let range_header = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let outcome = with_snapback(&state, move |snapback| {
        snapback.asset_deliver_signed(&id, &variant, &token, range_header.as_deref())
    })
    .await?;
    stream_asset_delivery(outcome).await
}

pub(super) async fn asset_deliver_public_route(
    State(state): State<SharedSnapback>,
    Path((id, variant)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let range_header = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let width = query
        .get("width")
        .and_then(|value| value.parse::<u64>().ok());
    let outcome = with_snapback(&state, move |snapback| {
        snapback.asset_deliver_public(&id, &variant, range_header.as_deref(), width)
    })
    .await?;
    stream_asset_delivery(outcome).await
}

pub(super) fn asset_delivery_header_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
        "assets",
        "delivery response could not be constructed",
    )
}

pub(super) async fn asset_record_delete_route(
    State(state): State<SharedSnapback>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let record = with_snapback(&state, move |snapback| {
        snapback.asset_delete(&authority, &id)
    })
    .await?;
    Ok(Json(record))
}
