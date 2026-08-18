//! The S3-compatible asset store: one seam for R2, Tigris, S3, B2, MinIO,
//! and GCS interop.
//!
//! @ref LLP 0044#byte-stores-and-resumable-transfer — configurations of one
//!   adapter, not product-specific storage APIs; each provider still earns
//!   an independent capability claim. The dev-lane store parameter
//!   (`s3-compatible`) was qualified against a live MinIO endpoint on
//!   2026-08-03 (`s3_store_live_endpoint_qualification`), so the local
//!   target declares it in `assetLifecycleStores`; hosted providers (R2,
//!   Tigris, ...) each still need their own qualification drill before any
//!   target claims them.
//!
//! Design notes, frozen here:
//! - SigV4 is hand-rolled over the in-tree `hmac`/`sha2` (single-chunk
//!   `UNSIGNED-PAYLOAD`-free signing with the payload hash included; query
//!   presigning uses `UNSIGNED-PAYLOAD` per the S3 convention).
//! - The proxied lane maps the trait directly (server-side puts/gets).
//!   `append_staging` is deliberately unsupported: the S3 resumable lane is
//!   native multipart driven by signed instructions, not server-proxied
//!   appends — those inherent methods live below and activate when the S3
//!   attempt routes land.
//! - Keys are prefix-scoped per instance (`{prefix}/staging/{key}`,
//!   `{prefix}/blobs/{key}`), so reset is a bounded prefix wipe and two
//!   instances can share a bucket without overlap. Keys stay opaque.
//! - Idempotent publication uses `If-None-Match: *` where the provider
//!   honors it (S3 and MinIO do on PUT; R2 documents support; providers
//!   that ignore it degrade to last-writer-wins over byte-identical content
//!   — identical by construction, since blob keys are minted per
//!   publication record and verified by re-hash). Provider variance is a
//!   qualification fact, not an assumption.

use crate::assets_store::{ASSET_OBJECT_HEAD_BYTES, AssetObjectDigest, AssetObjectRef, AssetStore};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use hmac::Mac as _;
use sha2::Digest as _;

pub const ASSET_STORE_S3_COMPATIBLE: &str = "s3-compatible";

#[derive(Clone, Debug)]
pub struct AssetS3Config {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    /// Instance keyspace prefix; every object key lives under it.
    pub key_prefix: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl AssetS3Config {
    /// Reads the `SNAPBACK_ASSET_S3_*` environment configuration once while
    /// LocalSnapback assembles its immutable startup configuration. Secrets
    /// are never logged or echoed into diagnostics, and store construction
    /// consumes only the captured value.
    pub fn from_env() -> SnapbackResult<Self> {
        fn required(name: &str) -> SnapbackResult<String> {
            std::env::var(name).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_CONFIG_INVALID",
                    "assets",
                    format!("the s3 store requires {name}"),
                )
            })
        }
        Ok(Self {
            endpoint: required("SNAPBACK_ASSET_S3_ENDPOINT")?,
            bucket: required("SNAPBACK_ASSET_S3_BUCKET")?,
            region: std::env::var("SNAPBACK_ASSET_S3_REGION")
                .unwrap_or_else(|_| "us-east-1".to_owned()),
            key_prefix: std::env::var("SNAPBACK_ASSET_S3_PREFIX")
                .unwrap_or_else(|_| "snapback-assets".to_owned()),
            access_key_id: required("SNAPBACK_ASSET_S3_ACCESS_KEY_ID")?,
            secret_access_key: required("SNAPBACK_ASSET_S3_SECRET_ACCESS_KEY")?,
        })
    }
}

/// One signed request, ready for a transport. The transport never sees
/// credentials — signing happens before it.
#[derive(Clone, Debug)]
pub struct S3Request {
    pub method: &'static str,
    /// Path-style URL below the endpoint: `/{bucket}/{key}` plus any query.
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct S3Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl S3Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// The transport seam: production uses `ureq`; the protocol tests use an
/// in-process fake that re-derives the SigV4 signature and enforces bucket
/// semantics, so the signing and state machines are validated without a
/// network.
pub trait S3Transport: Send + Sync {
    fn execute(&self, request: S3Request) -> SnapbackResult<S3Response>;
}

pub struct UreqTransport;

fn credential_isolated_agent(timeout: std::time::Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .try_proxy_from_env(false)
        .timeout_connect(timeout)
        .timeout_read(timeout)
        .timeout_write(timeout)
        .build()
}

impl S3Transport for UreqTransport {
    fn execute(&self, request: S3Request) -> SnapbackResult<S3Response> {
        let timeout = std::time::Duration::from_secs(30);
        let agent = credential_isolated_agent(timeout);
        let response_body_limit = if request
            .headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("range"))
        {
            CHUNK_READ_LIMIT as u64
        } else {
            S3_RESPONSE_BODY_MAX_BYTES
        };
        let mut call = agent.request(request.method, &request.url).timeout(timeout);
        for (name, value) in &request.headers {
            call = call.set(name, value);
        }
        let outcome = if request.body.is_empty() {
            call.call()
        } else {
            call.send_bytes(&request.body)
        };
        let response = match outcome {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(error) => {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!("s3 transport error: {error}"),
                ));
            }
        };
        let status = response.status();
        if (300..400).contains(&status) {
            // Credentialed S3 requests are terminal at their authored
            // endpoint. Following a provider or proxy redirect could replay
            // the SigV4 Authorization header to a different authority.
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                format!("s3 transport refused redirect status {status}"),
            ));
        }
        let headers = response
            .headers_names()
            .into_iter()
            .filter_map(|name| {
                response
                    .header(&name)
                    .map(|value| (name.clone(), value.to_owned()))
            })
            .collect();
        let mut body = Vec::new();
        use std::io::Read as _;
        response
            .into_reader()
            .take(response_body_limit + 1)
            .read_to_end(&mut body)
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!("s3 transport read error: {error}"),
                )
            })?;
        if body.len() as u64 > response_body_limit {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                format!("s3 response exceeded the {response_body_limit}-byte transport limit"),
            ));
        }
        Ok(S3Response {
            status,
            headers,
            body,
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&sha2::Sha256::digest(bytes))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac =
        hmac::Hmac::<sha2::Sha256>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// RFC 3986 unreserved-set encoding, the SigV4 canonical form. `/` is kept
/// in paths and encoded in query values.
fn sigv4_encode(input: &str, keep_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        let unreserved = byte.is_ascii_alphanumeric()
            || byte == b'-'
            || byte == b'_'
            || byte == b'.'
            || byte == b'~'
            || (keep_slash && byte == b'/');
        if unreserved {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `YYYYMMDDTHHMMSSZ` + `YYYYMMDD` from unix millis, without pulling a
/// datetime dependency: days-from-civil inverse (Howard Hinnant's
/// algorithm), UTC only.
fn amz_date(now_ms: i64) -> (String, String) {
    let secs = now_ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (hh, mm, ss) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    let date = format!("{year:04}{month:02}{day:02}");
    let stamp = format!("{date}T{hh:02}{mm:02}{ss:02}Z");
    (stamp, date)
}

pub struct AssetS3Store {
    config: AssetS3Config,
    transport: Box<dyn S3Transport>,
    /// Injected clock for deterministic signing tests; production uses the
    /// wall clock.
    now_ms: Box<dyn Fn() -> i64 + Send + Sync>,
}

const CHUNK_READ_LIMIT: usize = 8 * 1024 * 1024;
const S3_RESPONSE_BODY_MAX_BYTES: u64 = crate::assets::ASSET_BUFFERED_FINALIZE_MAX_BYTES;

impl AssetS3Store {
    pub fn new(config: AssetS3Config, transport: Box<dyn S3Transport>) -> Self {
        Self {
            config,
            transport,
            now_ms: Box::new(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            }),
        }
    }

    pub fn with_clock(
        config: AssetS3Config,
        transport: Box<dyn S3Transport>,
        now_ms: Box<dyn Fn() -> i64 + Send + Sync>,
    ) -> Self {
        Self {
            config,
            transport,
            now_ms,
        }
    }

    fn object_key(&self, object: AssetObjectRef<'_>) -> String {
        let (namespace, key, suffix) = match object {
            AssetObjectRef::Staging(key) => ("staging", key, ""),
            AssetObjectRef::Canonical(key) => ("staging", key, ".c14n"),
            AssetObjectRef::Blob(key) => ("blobs", key, ""),
        };
        format!("{}/{namespace}/{key}{suffix}", self.config.key_prefix)
    }

    fn canonical_path(&self, object_key: &str) -> String {
        format!(
            "/{}/{}",
            sigv4_encode(&self.config.bucket, true),
            sigv4_encode(object_key, true)
        )
    }

    /// SigV4-sign a header-authenticated request. Query pairs must arrive
    /// pre-sorted by key.
    fn sign(
        &self,
        method: &'static str,
        object_key: &str,
        query: &[(String, String)],
        extra_headers: &[(String, String)],
        body: Vec<u8>,
    ) -> S3Request {
        let (stamp, date) = amz_date((self.now_ms)());
        let host = self
            .config
            .endpoint
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_end_matches('/')
            .to_owned();
        let payload_hash = sha256_hex(&body);
        let path = self.canonical_path(object_key);
        let canonical_query = query
            .iter()
            .map(|(k, v)| format!("{}={}", sigv4_encode(k, false), sigv4_encode(v, false)))
            .collect::<Vec<_>>()
            .join("&");

        let mut signed_headers: Vec<(String, String)> = vec![
            ("host".to_owned(), host.clone()),
            ("x-amz-content-sha256".to_owned(), payload_hash.clone()),
            ("x-amz-date".to_owned(), stamp.clone()),
        ];
        for (name, value) in extra_headers {
            signed_headers.push((name.to_ascii_lowercase(), value.clone()));
        }
        signed_headers.sort_by(|a, b| a.0.cmp(&b.0));
        let canonical_headers = signed_headers
            .iter()
            .map(|(k, v)| format!("{k}:{}\n", v.trim()))
            .collect::<String>();
        let signed_header_names = signed_headers
            .iter()
            .map(|(k, _)| k.as_str())
            .collect::<Vec<_>>()
            .join(";");

        let canonical_request = format!(
            "{method}\n{path}\n{canonical_query}\n{canonical_headers}\n{signed_header_names}\n{payload_hash}"
        );
        let scope = format!("{date}/{}/s3/aws4_request", self.config.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{}",
            sha256_hex(canonical_request.as_bytes())
        );
        let k_date = hmac_sha256(
            format!("AWS4{}", self.config.secret_access_key).as_bytes(),
            date.as_bytes(),
        );
        let k_region = hmac_sha256(&k_date, self.config.region.as_bytes());
        let k_service = hmac_sha256(&k_region, b"s3");
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        let signature = hex(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));
        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_header_names}, Signature={signature}",
            self.config.access_key_id
        );

        let mut headers = signed_headers
            .into_iter()
            .filter(|(name, _)| name != "host")
            .collect::<Vec<_>>();
        headers.push(("authorization".to_owned(), authorization));
        let query_suffix = if canonical_query.is_empty() {
            String::new()
        } else {
            format!("?{canonical_query}")
        };
        S3Request {
            method,
            url: format!(
                "{}{path}{query_suffix}",
                self.config.endpoint.trim_end_matches('/')
            ),
            headers,
            body,
        }
    }

    /// Presign a URL (query-authenticated, `UNSIGNED-PAYLOAD`) for direct
    /// client transfer: PUT for upload instructions, GET for direct
    /// delivery. Expiry is seconds, provider-capped at 7 days.
    pub fn presign(
        &self,
        method: &'static str,
        object: AssetObjectRef<'_>,
        expires_secs: u64,
        part_query: &[(String, String)],
    ) -> String {
        let (stamp, date) = amz_date((self.now_ms)());
        let host = self
            .config
            .endpoint
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_end_matches('/')
            .to_owned();
        let object_key = self.object_key(object);
        let path = self.canonical_path(&object_key);
        let scope = format!("{date}/{}/s3/aws4_request", self.config.region);
        let mut query: Vec<(String, String)> = vec![
            ("X-Amz-Algorithm".into(), "AWS4-HMAC-SHA256".into()),
            (
                "X-Amz-Credential".into(),
                format!("{}/{scope}", self.config.access_key_id),
            ),
            ("X-Amz-Date".into(), stamp.clone()),
            ("X-Amz-Expires".into(), expires_secs.to_string()),
            ("X-Amz-SignedHeaders".into(), "host".into()),
        ];
        query.extend(part_query.iter().cloned());
        query.sort_by(|a, b| a.0.cmp(&b.0));
        let canonical_query = query
            .iter()
            .map(|(k, v)| format!("{}={}", sigv4_encode(k, false), sigv4_encode(v, false)))
            .collect::<Vec<_>>()
            .join("&");
        let canonical_request =
            format!("{method}\n{path}\n{canonical_query}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD");
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{}",
            sha256_hex(canonical_request.as_bytes())
        );
        let k_date = hmac_sha256(
            format!("AWS4{}", self.config.secret_access_key).as_bytes(),
            date.as_bytes(),
        );
        let k_region = hmac_sha256(&k_date, self.config.region.as_bytes());
        let k_service = hmac_sha256(&k_region, b"s3");
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        let signature = hex(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));
        format!(
            "{}{path}?{canonical_query}&X-Amz-Signature={signature}",
            self.config.endpoint.trim_end_matches('/')
        )
    }

    fn execute(&self, request: S3Request) -> SnapbackResult<S3Response> {
        self.transport.execute(request)
    }

    fn get_object(
        &self,
        object_key: &str,
        range: Option<(u64, u64)>,
    ) -> SnapbackResult<S3Response> {
        let headers = match range {
            Some((start, end_inclusive)) => {
                vec![("range".to_owned(), format!("bytes={start}-{end_inclusive}"))]
            }
            None => Vec::new(),
        };
        self.execute(self.sign("GET", object_key, &[], &headers, Vec::new()))
    }

    // ---- S3 native-multipart lane (inherent; activates with the S3
    // attempt routes — the shared trait stays proxied-lane only). ----

    pub fn multipart_create(&self, object: AssetObjectRef<'_>) -> SnapbackResult<String> {
        let key = self.object_key(object);
        let response = self.execute(self.sign(
            "POST",
            &key,
            &[("uploads".to_owned(), String::new())],
            &[],
            Vec::new(),
        ))?;
        if response.status != 200 {
            return Err(s3_status_error("multipart create", response.status));
        }
        extract_xml_tag(&response.body, "UploadId").ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "multipart create returned no upload id",
            )
        })
    }

    pub fn presign_part(
        &self,
        object: AssetObjectRef<'_>,
        upload_id: &str,
        part_number: u32,
        expires_secs: u64,
    ) -> String {
        self.presign(
            "PUT",
            object,
            expires_secs,
            &[
                ("partNumber".to_owned(), part_number.to_string()),
                ("uploadId".to_owned(), upload_id.to_owned()),
            ],
        )
    }

    pub fn multipart_complete(
        &self,
        object: AssetObjectRef<'_>,
        upload_id: &str,
        parts: &[(u32, String)],
    ) -> SnapbackResult<()> {
        let key = self.object_key(object);
        let mut body = String::from("<CompleteMultipartUpload>");
        for (number, etag) in parts {
            body.push_str(&format!(
                "<Part><PartNumber>{number}</PartNumber><ETag>{}</ETag></Part>",
                xml_escape_text(etag)
            ));
        }
        body.push_str("</CompleteMultipartUpload>");
        let response = self.execute(self.sign(
            "POST",
            &key,
            &[("uploadId".to_owned(), upload_id.to_owned())],
            &[],
            body.into_bytes(),
        ))?;
        if response.status != 200 {
            return Err(s3_status_error("multipart complete", response.status));
        }
        Ok(())
    }

    pub fn multipart_abort(
        &self,
        object: AssetObjectRef<'_>,
        upload_id: &str,
    ) -> SnapbackResult<()> {
        let key = self.object_key(object);
        let response = self.execute(self.sign(
            "DELETE",
            &key,
            &[("uploadId".to_owned(), upload_id.to_owned())],
            &[],
            Vec::new(),
        ))?;
        if response.status != 204 && response.status != 404 {
            return Err(s3_status_error("multipart abort", response.status));
        }
        Ok(())
    }

    fn list_prefix(&self, prefix: &str) -> SnapbackResult<Vec<String>> {
        // ListObjectsV2, path-style; continuation handled by re-listing
        // until the response is no longer truncated.
        let mut keys = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut query = vec![
                ("list-type".to_owned(), "2".to_owned()),
                ("prefix".to_owned(), prefix.to_owned()),
            ];
            if let Some(t) = &token {
                query.push(("continuation-token".to_owned(), t.clone()));
            }
            query.sort_by(|a, b| a.0.cmp(&b.0));
            let response = self.execute(self.sign("GET", "", &query, &[], Vec::new()))?;
            if response.status != 200 {
                return Err(s3_status_error("list", response.status));
            }
            let body = response.body.clone();
            let mut rest = body.as_slice();
            while let Some(key) = extract_xml_tag(rest, "Key") {
                keys.push(key.clone());
                let marker = format!("<Key>{key}</Key>");
                if let Some(pos) = find_subslice(rest, marker.as_bytes()) {
                    rest = &rest[pos + marker.len()..];
                } else {
                    break;
                }
            }
            if extract_xml_tag(&body, "IsTruncated").as_deref() == Some("true") {
                token = extract_xml_tag(&body, "NextContinuationToken");
                if token.is_none() {
                    break;
                }
            } else {
                break;
            }
        }
        Ok(keys)
    }
}

fn s3_status_error(context: &str, status: u16) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
        "assets",
        format!("s3 {context} failed with status {status}"),
    )
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len().max(1))
        .position(|window| window == needle)
}

fn extract_xml_tag(body: &[u8], tag: &str) -> Option<String> {
    let text = std::str::from_utf8(body).ok()?;
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(text[start..end].to_owned())
}

fn xml_escape_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other => escaped.push(other),
        }
    }
    escaped
}

impl AssetStore for AssetS3Store {
    fn kind(&self) -> &'static str {
        ASSET_STORE_S3_COMPATIBLE
    }

    fn append_staging(&self, _key: &str, _offset: u64, _chunk: &[u8]) -> SnapbackResult<()> {
        // The S3 resumable lane is native multipart with signed
        // instructions (LLP 0044); server-proxied appends belong to the
        // fs/TUS lane only.
        Err(SnapbackError::error(
            "SNAPBACK_ASSET_STORE_OP_UNSUPPORTED",
            "assets",
            "the s3 store's resumable lane is native multipart, not proxied appends",
        ))
    }

    fn write_canonical(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        let object_key = self.object_key(AssetObjectRef::Canonical(key));
        let response = self.execute(self.sign("PUT", &object_key, &[], &[], bytes.to_vec()))?;
        if response.status != 200 {
            return Err(s3_status_error("canonical put", response.status));
        }
        Ok(())
    }

    fn put_blob_idempotent(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        let object_key = self.object_key(AssetObjectRef::Blob(key));
        let headers = vec![("if-none-match".to_owned(), "*".to_owned())];
        let response =
            self.execute(self.sign("PUT", &object_key, &[], &headers, bytes.to_vec()))?;
        // 412 = the object already exists under If-None-Match — the
        // idempotent-put success case.
        if response.status != 200 && response.status != 412 {
            return Err(s3_status_error("blob put", response.status));
        }
        Ok(())
    }

    fn read(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Vec<u8>> {
        let response = self.get_object(&self.object_key(object), None)?;
        if response.status == 404 {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "cannot read object: not found",
            ));
        }
        if response.status != 200 {
            return Err(s3_status_error("get", response.status));
        }
        Ok(response.body)
    }

    fn read_chunk(
        &self,
        object: AssetObjectRef<'_>,
        offset: u64,
        max_len: usize,
    ) -> SnapbackResult<Vec<u8>> {
        let max_len = max_len.min(CHUNK_READ_LIMIT);
        if max_len == 0 {
            return Ok(Vec::new());
        }
        let end_inclusive = offset.saturating_add(max_len as u64 - 1);
        let response = self.get_object(&self.object_key(object), Some((offset, end_inclusive)))?;
        match response.status {
            200 => Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "s3 provider ignored a ranged object read",
            )),
            206 if response.body.len() <= max_len => Ok(response.body),
            206 => Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "s3 ranged object read exceeded the requested window",
            )),
            // Past EOF: the fs store returns empty at EOF; mirror it.
            416 => Ok(Vec::new()),
            404 => Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "cannot read object: not found",
            )),
            status => Err(s3_status_error("ranged get", status)),
        }
    }

    fn hash(&self, object: AssetObjectRef<'_>) -> SnapbackResult<AssetObjectDigest> {
        // Server-side read-back: stream in bounded chunks through SHA-256,
        // exactly the trusted-finalization contract. Chatty on providers
        // without coalesced reads; the qualification suite measures it.
        let mut hasher = sha2::Sha256::new();
        let mut head = Vec::with_capacity(ASSET_OBJECT_HEAD_BYTES);
        let mut byte_length = 0u64;
        loop {
            let chunk = self.read_chunk(object, byte_length, CHUNK_READ_LIMIT)?;
            if chunk.is_empty() {
                break;
            }
            if head.len() < ASSET_OBJECT_HEAD_BYTES {
                let take = (ASSET_OBJECT_HEAD_BYTES - head.len()).min(chunk.len());
                head.extend_from_slice(&chunk[..take]);
            }
            byte_length += chunk.len() as u64;
            hasher.update(&chunk);
            if chunk.len() < CHUNK_READ_LIMIT {
                break;
            }
        }
        Ok(AssetObjectDigest {
            byte_length,
            digest: hex(&hasher.finalize()),
            head,
        })
    }

    fn exists(&self, object: AssetObjectRef<'_>) -> SnapbackResult<bool> {
        Ok(self.len(object)?.is_some())
    }

    fn len(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Option<u64>> {
        let object_key = self.object_key(object);
        let response = self.execute(self.sign("HEAD", &object_key, &[], &[], Vec::new()))?;
        match response.status {
            200 => Ok(response
                .header("content-length")
                .and_then(|value| value.parse::<u64>().ok())),
            404 => Ok(None),
            status => Err(s3_status_error("head", status)),
        }
    }

    fn delete_blob(&self, key: &str) -> SnapbackResult<()> {
        let object_key = self.object_key(AssetObjectRef::Blob(key));
        let response = self.execute(self.sign("DELETE", &object_key, &[], &[], Vec::new()))?;
        if response.status != 204 && response.status != 404 {
            return Err(s3_status_error("delete", response.status));
        }
        Ok(())
    }

    fn delete_staging_pair(&self, key: &str) -> SnapbackResult<()> {
        for object in [AssetObjectRef::Staging(key), AssetObjectRef::Canonical(key)] {
            let object_key = self.object_key(object);
            let response = self.execute(self.sign("DELETE", &object_key, &[], &[], Vec::new()))?;
            if response.status != 204 && response.status != 404 {
                return Err(s3_status_error("staging delete", response.status));
            }
        }
        Ok(())
    }

    fn list_staging_keys(&self) -> SnapbackResult<Vec<String>> {
        let prefix = format!("{}/staging/", self.config.key_prefix);
        let mut keys = Vec::new();
        for object_key in self.list_prefix(&prefix)? {
            let Some(name) = object_key.strip_prefix(&prefix) else {
                continue;
            };
            let key = name.strip_suffix(".c14n").unwrap_or(name);
            if !keys.iter().any(|existing: &String| existing == key) {
                keys.push(key.to_owned());
            }
        }
        Ok(keys)
    }

    fn copy_blob(&self, from: &str, to: &str) -> SnapbackResult<()> {
        let source = format!(
            "/{}/{}",
            self.config.bucket,
            self.object_key(AssetObjectRef::Blob(from))
        );
        let target = self.object_key(AssetObjectRef::Blob(to));
        let headers = vec![("x-amz-copy-source".to_owned(), source)];
        let response = self.execute(self.sign("PUT", &target, &[], &headers, Vec::new()))?;
        if response.status != 200 {
            return Err(s3_status_error("copy", response.status));
        }
        Ok(())
    }

    fn wipe_all(&self) -> SnapbackResult<()> {
        // Bounded prefix wipe: reset on an S3-backed instance deletes the
        // instance's keyspace, never the bucket.
        for object_key in self.list_prefix(&format!("{}/", self.config.key_prefix))? {
            let response =
                self.execute(self.sign("DELETE", object_key.as_str(), &[], &[], Vec::new()))?;
            if response.status != 204 && response.status != 404 {
                return Err(s3_status_error("wipe", response.status));
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Protocol tests: an in-process S3-semantics fake that independently
// re-derives SigV4 from the received request materials and enforces bucket
// semantics, so signing and the multipart/publication/range/wipe state
// machines are validated without a network. The live-endpoint suite below
// runs the same shapes against a real S3-compatible server when
// SNAPBACK_S3_TEST_* is set, and skips honestly otherwise.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn ureq_transport_agent_refuses_redirects_and_ignores_environment_proxies() {
        const CHILD_MARKER: &str = "SNAPBACK_S3_PROXY_POLICY_CHILD";
        if std::env::var_os(CHILD_MARKER).is_some() {
            let agent = credential_isolated_agent(std::time::Duration::from_secs(1));
            let debug = format!("{agent:?}");
            assert!(debug.contains("proxy: None"), "env proxy leaked: {debug}");
            assert!(debug.contains("redirects: 0"), "redirects enabled: {debug}");
            return;
        }

        let output = std::process::Command::new(
            std::env::current_exe().expect("current test executable"),
        )
        .args([
            "--exact",
            "assets_s3::tests::ureq_transport_agent_refuses_redirects_and_ignores_environment_proxies",
            "--nocapture",
        ])
        .env(CHILD_MARKER, "1")
        .env("HTTP_PROXY", "http://127.0.0.1:9")
        .env("HTTPS_PROXY", "http://127.0.0.1:9")
        .env("ALL_PROXY", "http://127.0.0.1:9")
        .env("NO_PROXY", "")
        .env("no_proxy", "")
        .output()
        .expect("run isolated S3 proxy-policy child");
        assert!(
            output.status.success(),
            "S3 proxy-policy child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn ureq_transport_refuses_redirect_without_replaying_sigv4() {
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;

        let sink = TcpListener::bind("127.0.0.1:0").expect("bind redirect sink");
        sink.set_nonblocking(true).expect("nonblocking sink");
        let sink_url = format!("http://{}/stolen", sink.local_addr().unwrap());
        let redirect = TcpListener::bind("127.0.0.1:0").expect("bind redirect origin");
        let redirect_url = format!("http://{}/object", redirect.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = redirect.accept().expect("accept S3 request");
            let mut request = [0u8; 4096];
            let read = stream.read(&mut request).expect("read S3 request");
            let request = String::from_utf8_lossy(&request[..read]).to_ascii_lowercase();
            assert!(
                request.contains("authorization: aws4-hmac-sha256 test-signature"),
                "the authored endpoint receives the signed request"
            );
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nLocation: {sink_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .expect("write redirect");
            stream.flush().expect("flush redirect");
        });

        let error = UreqTransport
            .execute(S3Request {
                method: "GET",
                url: redirect_url,
                headers: vec![(
                    "authorization".to_owned(),
                    "AWS4-HMAC-SHA256 test-signature".to_owned(),
                )],
                body: Vec::new(),
            })
            .expect_err("credentialed S3 redirects are terminal");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_STORE_UNAVAILABLE");
        server.join().expect("redirect origin exits");
        let replay = sink.accept().expect_err("redirect sink receives no replay");
        assert_eq!(replay.kind(), std::io::ErrorKind::WouldBlock);
    }

    #[test]
    fn ureq_transport_preserves_successful_responses() {
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind S3 origin");
        let url = format!("http://{}/object", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept S3 request");
            let mut request = [0u8; 4096];
            let read = stream.read(&mut request).expect("read S3 request");
            let request = String::from_utf8_lossy(&request[..read]).to_ascii_lowercase();
            assert!(request.contains("authorization: aws4-hmac-sha256 test-signature"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nX-Test: kept\r\nConnection: close\r\n\r\nok",
                )
                .expect("write response");
            stream.flush().expect("flush response");
        });

        let response = UreqTransport
            .execute(S3Request {
                method: "GET",
                url,
                headers: vec![(
                    "authorization".to_owned(),
                    "AWS4-HMAC-SHA256 test-signature".to_owned(),
                )],
                body: Vec::new(),
            })
            .expect("ordinary 2xx S3 response remains available");
        assert_eq!(response.status, 200);
        assert_eq!(response.header("x-test"), Some("kept"));
        assert_eq!(response.body, b"ok");
        server.join().expect("S3 origin exits");
    }

    #[derive(Default)]
    struct Bucket {
        objects: BTreeMap<String, Vec<u8>>,
        multiparts: BTreeMap<String, BTreeMap<u32, Vec<u8>>>,
        next_upload: u64,
    }

    #[derive(Clone)]
    struct FakeS3 {
        bucket_name: String,
        secret: String,
        access_key: String,
        state: Arc<Mutex<Bucket>>,
        clock: Arc<AtomicI64>,
    }

    fn parse_query(url: &str) -> Vec<(String, String)> {
        let Some((_, query)) = url.split_once('?') else {
            return Vec::new();
        };
        query
            .split('&')
            .map(|pair| {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                (percent_decode(k), percent_decode(v))
            })
            .collect()
    }

    fn percent_decode(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%'
                && i + 2 < bytes.len()
                && let Ok(byte) = u8::from_str_radix(
                    std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"),
                    16,
                )
            {
                out.push(byte);
                i += 3;
                continue;
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    impl FakeS3 {
        fn new() -> (Self, AssetS3Config, Arc<AtomicI64>) {
            let clock = Arc::new(AtomicI64::new(1_753_900_000_000));
            let fake = FakeS3 {
                bucket_name: "snapback-test".into(),
                secret: "test-secret".into(),
                access_key: "AKIDTEST".into(),
                state: Arc::new(Mutex::new(Bucket::default())),
                clock: clock.clone(),
            };
            let config = AssetS3Config {
                endpoint: "http://s3.fake.local".into(),
                bucket: fake.bucket_name.clone(),
                region: "us-east-1".into(),
                key_prefix: "instance-a".into(),
                access_key_id: fake.access_key.clone(),
                secret_access_key: fake.secret.clone(),
            };
            (fake, config, clock)
        }

        fn store(&self, config: &AssetS3Config) -> AssetS3Store {
            let clock = self.clock.clone();
            AssetS3Store::with_clock(
                config.clone(),
                Box::new(self.clone()),
                Box::new(move || clock.load(Ordering::SeqCst)),
            )
        }

        /// Independent SigV4 derivation from the received materials — never
        /// calls the store's signer.
        // The fake independently derives the complete SigV4 tuple; keeping
        // every signed component explicit makes omission bugs visible.
        #[allow(clippy::too_many_arguments)]
        fn expected_signature(
            &self,
            method: &str,
            path: &str,
            canonical_query: &str,
            signed_headers: &[(String, String)],
            payload_hash: &str,
            stamp: &str,
            date: &str,
            region: &str,
        ) -> String {
            let canonical_headers = signed_headers
                .iter()
                .map(|(k, v)| format!("{k}:{}\n", v.trim()))
                .collect::<String>();
            let names = signed_headers
                .iter()
                .map(|(k, _)| k.as_str())
                .collect::<Vec<_>>()
                .join(";");
            let canonical_request = format!(
                "{method}\n{path}\n{canonical_query}\n{canonical_headers}\n{names}\n{payload_hash}"
            );
            let scope = format!("{date}/{region}/s3/aws4_request");
            let string_to_sign = format!(
                "AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{}",
                sha256_hex(canonical_request.as_bytes())
            );
            let k_date = hmac_sha256(format!("AWS4{}", self.secret).as_bytes(), date.as_bytes());
            let k_region = hmac_sha256(&k_date, region.as_bytes());
            let k_service = hmac_sha256(&k_region, b"s3");
            let k_signing = hmac_sha256(&k_service, b"aws4_request");
            hex(&hmac_sha256(&k_signing, string_to_sign.as_bytes()))
        }

        /// Simulate a client hitting a presigned URL (query-authenticated).
        fn http_presigned(&self, method: &str, url: &str, body: &[u8]) -> S3Response {
            let path = url
                .trim_start_matches("http://s3.fake.local")
                .split('?')
                .next()
                .unwrap()
                .to_owned();
            let mut query = parse_query(url);
            query.sort_by(|a, b| a.0.cmp(&b.0));
            let signature = query
                .iter()
                .find(|(k, _)| k == "X-Amz-Signature")
                .map(|(_, v)| v.clone())
                .unwrap_or_default();
            let without_sig: Vec<(String, String)> = query
                .iter()
                .filter(|(k, _)| k != "X-Amz-Signature")
                .cloned()
                .collect();
            let canonical_query = without_sig
                .iter()
                .map(|(k, v)| format!("{}={}", sigv4_encode(k, false), sigv4_encode(v, false)))
                .collect::<Vec<_>>()
                .join("&");
            let stamp = without_sig
                .iter()
                .find(|(k, _)| k == "X-Amz-Date")
                .map(|(_, v)| v.clone())
                .unwrap_or_default();
            let date = stamp.split('T').next().unwrap_or("").to_owned();
            let expires: i64 = without_sig
                .iter()
                .find(|(k, _)| k == "X-Amz-Expires")
                .and_then(|(_, v)| v.parse().ok())
                .unwrap_or(0);
            // Expiry check against the fake's clock.
            let (now_stamp, _) = amz_date(self.clock.load(Ordering::SeqCst));
            if now_stamp > {
                // stamp + expires as a lexically comparable stamp: recompute
                // from the parsed epoch is overkill for the fake; compare by
                // reconstructing the expiry stamp from the signing stamp's
                // epoch position in our injected clock domain instead.
                let signed_ms = stamp_to_ms(&stamp);
                let (expiry_stamp, _) = amz_date(signed_ms + expires * 1000);
                expiry_stamp
            } {
                return S3Response {
                    status: 403,
                    headers: vec![],
                    body: b"expired".to_vec(),
                };
            }
            let expected = self.expected_signature(
                method,
                &path,
                &canonical_query,
                &[("host".into(), "s3.fake.local".into())],
                "UNSIGNED-PAYLOAD",
                &stamp,
                &date,
                "us-east-1",
            );
            if expected != signature {
                return S3Response {
                    status: 403,
                    headers: vec![],
                    body: b"bad sig".to_vec(),
                };
            }
            self.apply(method, &path, &without_sig, &[], body)
        }

        fn apply(
            &self,
            method: &str,
            path: &str,
            query: &[(String, String)],
            headers: &[(String, String)],
            body: &[u8],
        ) -> S3Response {
            let key = path
                .trim_start_matches(&format!("/{}", self.bucket_name))
                .trim_start_matches('/')
                .to_owned();
            let key = percent_decode(&key);
            let mut state = self.state.lock().unwrap();
            let get_header = |name: &str| {
                headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(name))
                    .map(|(_, v)| v.clone())
            };
            let query_get = |name: &str| {
                query
                    .iter()
                    .find(|(k, _)| k == name)
                    .map(|(_, v)| v.clone())
            };
            match method {
                "PUT" if query_get("partNumber").is_some() => {
                    let upload = query_get("uploadId").unwrap_or_default();
                    let part: u32 = query_get("partNumber").unwrap().parse().unwrap();
                    let Some(parts) = state.multiparts.get_mut(&upload) else {
                        return S3Response {
                            status: 404,
                            headers: vec![],
                            body: vec![],
                        };
                    };
                    parts.insert(part, body.to_vec());
                    S3Response {
                        status: 200,
                        headers: vec![("etag".into(), format!("\"p{part}\""))],
                        body: vec![],
                    }
                }
                "POST" if query.iter().any(|(k, _)| k == "uploads") => {
                    state.next_upload += 1;
                    let id = format!("mpu-{}", state.next_upload);
                    state.multiparts.insert(id.clone(), BTreeMap::new());
                    S3Response {
                        status: 200,
                        headers: vec![],
                        body: format!(
                            "<InitiateMultipartUploadResult><UploadId>{id}</UploadId></InitiateMultipartUploadResult>"
                        )
                        .into_bytes(),
                    }
                }
                "POST" if query_get("uploadId").is_some() => {
                    let upload = query_get("uploadId").unwrap();
                    let Some(parts) = state.multiparts.remove(&upload) else {
                        return S3Response {
                            status: 404,
                            headers: vec![],
                            body: vec![],
                        };
                    };
                    let mut assembled = Vec::new();
                    for (_, part) in parts {
                        assembled.extend_from_slice(&part);
                    }
                    state.objects.insert(key, assembled);
                    S3Response {
                        status: 200,
                        headers: vec![],
                        body: b"<ok/>".to_vec(),
                    }
                }
                "PUT" if get_header("x-amz-copy-source").is_some() => {
                    let source = get_header("x-amz-copy-source").unwrap();
                    let source_key = percent_decode(
                        source.trim_start_matches(&format!("/{}/", self.bucket_name)),
                    );
                    let Some(bytes) = state.objects.get(&source_key).cloned() else {
                        return S3Response {
                            status: 404,
                            headers: vec![],
                            body: vec![],
                        };
                    };
                    state.objects.insert(key, bytes);
                    S3Response {
                        status: 200,
                        headers: vec![],
                        body: b"<ok/>".to_vec(),
                    }
                }
                "PUT" => {
                    if get_header("if-none-match").as_deref() == Some("*")
                        && state.objects.contains_key(&key)
                    {
                        return S3Response {
                            status: 412,
                            headers: vec![],
                            body: vec![],
                        };
                    }
                    state.objects.insert(key, body.to_vec());
                    S3Response {
                        status: 200,
                        headers: vec![],
                        body: vec![],
                    }
                }
                "HEAD" => match state.objects.get(&key) {
                    Some(bytes) => S3Response {
                        status: 200,
                        headers: vec![("content-length".into(), bytes.len().to_string())],
                        body: vec![],
                    },
                    None => S3Response {
                        status: 404,
                        headers: vec![],
                        body: vec![],
                    },
                },
                "GET" if query_get("list-type").as_deref() == Some("2") => {
                    let prefix = query_get("prefix").unwrap_or_default();
                    let keys = state
                        .objects
                        .keys()
                        .filter(|k| k.starts_with(&prefix))
                        .map(|k| format!("<Key>{k}</Key>"))
                        .collect::<String>();
                    S3Response {
                        status: 200,
                        headers: vec![],
                        body: format!(
                            "<ListBucketResult><IsTruncated>false</IsTruncated>{keys}</ListBucketResult>"
                        )
                        .into_bytes(),
                    }
                }
                "GET" => {
                    let Some(bytes) = state.objects.get(&key) else {
                        return S3Response {
                            status: 404,
                            headers: vec![],
                            body: vec![],
                        };
                    };
                    match get_header("range") {
                        Some(range) => {
                            let spec = range.trim_start_matches("bytes=");
                            let (start, end) = spec.split_once('-').unwrap_or((spec, ""));
                            let start: u64 = start.parse().unwrap_or(0);
                            if start >= bytes.len() as u64 {
                                return S3Response {
                                    status: 416,
                                    headers: vec![],
                                    body: vec![],
                                };
                            }
                            let end: u64 = end
                                .parse()
                                .unwrap_or(bytes.len() as u64 - 1)
                                .min(bytes.len() as u64 - 1);
                            S3Response {
                                status: 206,
                                headers: vec![],
                                body: bytes[start as usize..=end as usize].to_vec(),
                            }
                        }
                        None => S3Response {
                            status: 200,
                            headers: vec![],
                            body: bytes.clone(),
                        },
                    }
                }
                "DELETE" if query_get("uploadId").is_some() => {
                    let upload = query_get("uploadId").unwrap();
                    state.multiparts.remove(&upload);
                    S3Response {
                        status: 204,
                        headers: vec![],
                        body: vec![],
                    }
                }
                "DELETE" => {
                    let existed = state.objects.remove(&key).is_some();
                    S3Response {
                        status: if existed { 204 } else { 404 },
                        headers: vec![],
                        body: vec![],
                    }
                }
                _ => S3Response {
                    status: 400,
                    headers: vec![],
                    body: vec![],
                },
            }
        }
    }

    fn stamp_to_ms(stamp: &str) -> i64 {
        // Inverse of amz_date for the fake's expiry math (UTC).
        let bytes = stamp.as_bytes();
        let get = |range: std::ops::Range<usize>| -> i64 {
            std::str::from_utf8(&bytes[range])
                .unwrap_or("0")
                .parse()
                .unwrap_or(0)
        };
        let (year, month, day) = (get(0..4), get(4..6), get(6..8));
        let (hh, mm, ss) = (get(9..11), get(11..13), get(13..15));
        let y = if month <= 2 { year - 1 } else { year };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let mp = if month > 2 { month - 3 } else { month + 9 };
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;
        ((days * 86_400) + hh * 3600 + mm * 60 + ss) * 1000
    }

    impl S3Transport for FakeS3 {
        fn execute(&self, request: S3Request) -> SnapbackResult<S3Response> {
            let path = request
                .url
                .trim_start_matches("http://s3.fake.local")
                .split('?')
                .next()
                .unwrap()
                .to_owned();
            let mut query = parse_query(&request.url);
            query.sort_by(|a, b| a.0.cmp(&b.0));
            let canonical_query = query
                .iter()
                .map(|(k, v)| format!("{}={}", sigv4_encode(k, false), sigv4_encode(v, false)))
                .collect::<Vec<_>>()
                .join("&");
            let auth = request
                .headers
                .iter()
                .find(|(k, _)| k == "authorization")
                .map(|(_, v)| v.clone())
                .unwrap_or_default();
            let signature = auth.split("Signature=").nth(1).unwrap_or("").to_owned();
            let signed_names: Vec<&str> = auth
                .split("SignedHeaders=")
                .nth(1)
                .and_then(|rest| rest.split(',').next())
                .map(|names| names.split(';').collect())
                .unwrap_or_default();
            let header_value = |name: &str| -> String {
                if name == "host" {
                    return "s3.fake.local".into();
                }
                request
                    .headers
                    .iter()
                    .find(|(k, _)| k == name)
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default()
            };
            let signed_headers: Vec<(String, String)> = signed_names
                .iter()
                .map(|name| (name.to_string(), header_value(name)))
                .collect();
            let stamp = header_value("x-amz-date");
            let date = stamp.split('T').next().unwrap_or("").to_owned();
            let payload_hash = header_value("x-amz-content-sha256");
            if sha256_hex(&request.body) != payload_hash {
                return Ok(S3Response {
                    status: 403,
                    headers: vec![],
                    body: b"payload".to_vec(),
                });
            }
            let expected = self.expected_signature(
                request.method,
                &path,
                &canonical_query,
                &signed_headers,
                &payload_hash,
                &stamp,
                &date,
                "us-east-1",
            );
            if expected != signature {
                return Ok(S3Response {
                    status: 403,
                    headers: vec![],
                    body: b"bad sig".to_vec(),
                });
            }
            let headers: Vec<(String, String)> = request.headers.clone();
            Ok(self.apply(request.method, &path, &query, &headers, &request.body))
        }
    }

    #[test]
    fn s3_store_blob_publication_protocol_is_idempotent_and_verifiable() {
        let (fake, config, _) = FakeS3::new();
        let store = fake.store(&config);
        let bytes = b"canonical-bytes".to_vec();
        store.put_blob_idempotent("blob-1", &bytes).expect("put");
        // Second put converges through the If-None-Match 412 arm.
        store
            .put_blob_idempotent("blob-1", &bytes)
            .expect("idempotent");
        let hashed = store.hash(AssetObjectRef::Blob("blob-1")).expect("hash");
        assert_eq!(hashed.byte_length, bytes.len() as u64);
        assert_eq!(hashed.digest, sha256_hex(&bytes));
        assert_eq!(hashed.head, bytes);
        assert!(
            store
                .exists(AssetObjectRef::Blob("blob-1"))
                .expect("exists")
        );
        assert_eq!(
            store.len(AssetObjectRef::Blob("blob-1")).expect("len"),
            Some(bytes.len() as u64)
        );
        store.copy_blob("blob-1", "blob-2").expect("copy");
        assert_eq!(
            store.read(AssetObjectRef::Blob("blob-2")).expect("read"),
            bytes
        );
        store.delete_blob("blob-1").expect("delete");
        store.delete_blob("blob-1").expect("tolerant re-delete");
        assert!(!store.exists(AssetObjectRef::Blob("blob-1")).expect("gone"));
    }

    #[test]
    fn s3_store_range_reads_mirror_fs_semantics() {
        let (fake, config, _) = FakeS3::new();
        let store = fake.store(&config);
        let bytes: Vec<u8> = (0u8..100).collect();
        store.put_blob_idempotent("ranged", &bytes).expect("put");
        assert_eq!(
            store
                .read_chunk(AssetObjectRef::Blob("ranged"), 0, 100)
                .expect("full"),
            bytes
        );
        assert_eq!(
            store
                .read_chunk(AssetObjectRef::Blob("ranged"), 10, 5)
                .expect("mid"),
            bytes[10..15].to_vec()
        );
        // Past EOF mirrors the fs store: empty, not an error.
        assert!(
            store
                .read_chunk(AssetObjectRef::Blob("ranged"), 200, 5)
                .expect("past eof")
                .is_empty()
        );
        assert!(
            store
                .read_chunk(AssetObjectRef::Blob("ranged"), 0, 0)
                .expect("zero")
                .is_empty()
        );
    }

    #[test]
    fn s3_store_refuses_a_provider_that_ignores_ranges() {
        #[derive(Clone)]
        struct RangeIgnoringS3(FakeS3);

        impl S3Transport for RangeIgnoringS3 {
            fn execute(&self, request: S3Request) -> SnapbackResult<S3Response> {
                let ranged = request
                    .headers
                    .iter()
                    .any(|(name, _)| name.eq_ignore_ascii_case("range"));
                let mut response = self.0.execute(request)?;
                if ranged && response.status == 206 {
                    response.status = 200;
                }
                Ok(response)
            }
        }

        let (fake, config, clock) = FakeS3::new();
        let store = AssetS3Store::with_clock(
            config,
            Box::new(RangeIgnoringS3(fake)),
            Box::new(move || clock.load(Ordering::SeqCst)),
        );
        store
            .put_blob_idempotent("ignored-range", b"0123456789")
            .expect("put");
        let error = store
            .read_chunk(AssetObjectRef::Blob("ignored-range"), 2, 3)
            .expect_err("status 200 cannot satisfy the ranged-read contract");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_STORE_UNAVAILABLE");
    }

    #[test]
    fn multipart_etags_are_xml_escaped() {
        assert_eq!(
            xml_escape_text("\"abc</ETag><Part>&'\""),
            "&quot;abc&lt;/ETag&gt;&lt;Part&gt;&amp;&apos;&quot;"
        );
    }

    #[test]
    fn s3_store_multipart_lane_and_presigned_urls_validate_and_expire() {
        let (fake, config, clock) = FakeS3::new();
        let store = fake.store(&config);
        let upload = store
            .multipart_create(AssetObjectRef::Staging("stage-1"))
            .expect("create");
        let part1 = store.presign_part(AssetObjectRef::Staging("stage-1"), &upload, 1, 900);
        let part2 = store.presign_part(AssetObjectRef::Staging("stage-1"), &upload, 2, 900);
        let r1 = fake.http_presigned("PUT", &part1, b"hello ");
        let r2 = fake.http_presigned("PUT", &part2, b"world");
        assert_eq!((r1.status, r2.status), (200, 200));
        let etag = |r: &S3Response| r.header("etag").unwrap().to_owned();
        store
            .multipart_complete(
                AssetObjectRef::Staging("stage-1"),
                &upload,
                &[(1, etag(&r1)), (2, etag(&r2))],
            )
            .expect("complete");
        assert_eq!(
            store
                .read(AssetObjectRef::Staging("stage-1"))
                .expect("assembled"),
            b"hello world".to_vec()
        );

        // Presigned GET honors expiry against the injected clock.
        let url = store.presign("GET", AssetObjectRef::Staging("stage-1"), 60, &[]);
        assert_eq!(fake.http_presigned("GET", &url, b"").status, 200);
        clock.fetch_add(120_000, Ordering::SeqCst);
        assert_eq!(fake.http_presigned("GET", &url, b"").status, 403);
        // Tampered signature refuses.
        let tampered = format!("{url}0");
        clock.fetch_add(-120_000, Ordering::SeqCst);
        assert_eq!(fake.http_presigned("GET", &tampered, b"").status, 403);

        // Abort drops an open upload.
        let upload2 = store
            .multipart_create(AssetObjectRef::Staging("stage-2"))
            .expect("create2");
        store
            .multipart_abort(AssetObjectRef::Staging("stage-2"), &upload2)
            .expect("abort");
    }

    #[test]
    fn s3_store_prefix_scoped_wipe_and_staging_list() {
        let (fake, config, _) = FakeS3::new();
        let store_a = fake.store(&config);
        let mut config_b = config.clone();
        config_b.key_prefix = "instance-b".into();
        let store_b = fake.store(&config_b);

        store_a
            .append_staging("s", 0, b"x")
            .expect_err("s3 lane has no proxied append");
        store_a
            .write_canonical("stage-a", b"canon")
            .expect("canonical");
        store_a.put_blob_idempotent("blob-a", b"a").expect("blob a");
        store_b.put_blob_idempotent("blob-b", b"b").expect("blob b");

        // The canonical sibling folds into its source custody unit.
        let keys = store_a.list_staging_keys().expect("list");
        assert_eq!(keys, vec!["stage-a".to_owned()]);

        store_a.wipe_all().expect("wipe a");
        assert!(
            !store_a
                .exists(AssetObjectRef::Blob("blob-a"))
                .expect("a gone")
        );
        assert!(
            store_b
                .exists(AssetObjectRef::Blob("blob-b"))
                .expect("b survives")
        );

        store_a
            .delete_staging_pair("stage-a")
            .expect("tolerant after wipe");
    }

    #[test]
    fn s3_store_tampered_header_request_is_refused_by_independent_derivation() {
        let (fake, config, _) = FakeS3::new();
        let store = fake.store(&config);
        // A request whose signed header changes after signing must refuse:
        // sign for one payload, deliver another.
        let signed = store.sign(
            "PUT",
            "instance-a/blobs/tamper",
            &[],
            &[],
            b"honest".to_vec(),
        );
        let mut tampered = signed.clone();
        tampered.body = b"tampered".to_vec();
        let response = fake.execute(tampered).expect("transport");
        assert_eq!(response.status, 403);
        let response = fake.execute(signed).expect("transport");
        assert_eq!(response.status, 200);
    }

    /// The live qualification suite: the same protocol shapes against a real
    /// S3-compatible endpoint. Skips honestly when no endpoint is
    /// configured; the qualification-drill ticket records the runnable
    /// recipe (MinIO or R2/Tigris credentials).
    #[test]
    fn s3_store_live_endpoint_qualification() {
        let Ok(endpoint) = std::env::var("SNAPBACK_S3_TEST_ENDPOINT") else {
            eprintln!(
                "skipping live s3 qualification: SNAPBACK_S3_TEST_ENDPOINT is unset \
                 (see the 0044 s3 qualification-drill ticket for the recipe)"
            );
            return;
        };
        let config = AssetS3Config {
            endpoint,
            bucket: std::env::var("SNAPBACK_S3_TEST_BUCKET").expect("bucket"),
            region: std::env::var("SNAPBACK_S3_TEST_REGION").unwrap_or_else(|_| "us-east-1".into()),
            key_prefix: format!("snapback-qual-{}", std::process::id()),
            access_key_id: std::env::var("SNAPBACK_S3_TEST_ACCESS_KEY_ID").expect("access key"),
            secret_access_key: std::env::var("SNAPBACK_S3_TEST_SECRET_ACCESS_KEY").expect("secret"),
        };
        let store = AssetS3Store::new(config, Box::new(UreqTransport));
        let bytes = b"live-qualification-bytes".to_vec();
        store.put_blob_idempotent("qual-blob", &bytes).expect("put");
        store
            .put_blob_idempotent("qual-blob", &bytes)
            .expect("idempotent");
        let hashed = store.hash(AssetObjectRef::Blob("qual-blob")).expect("hash");
        assert_eq!(hashed.digest, sha256_hex(&bytes));
        assert_eq!(
            store
                .read_chunk(AssetObjectRef::Blob("qual-blob"), 5, 8)
                .expect("range"),
            bytes[5..13].to_vec()
        );
        let upload = store
            .multipart_create(AssetObjectRef::Staging("qual-stage"))
            .expect("mpu create");
        store
            .multipart_abort(AssetObjectRef::Staging("qual-stage"), &upload)
            .expect("mpu abort");
        store.wipe_all().expect("wipe");
        assert!(
            !store
                .exists(AssetObjectRef::Blob("qual-blob"))
                .expect("clean")
        );
    }
}
