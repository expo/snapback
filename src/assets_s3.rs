//! The S3-compatible asset store: one seam for R2, Tigris, S3, B2, MinIO,
//! and GCS interop.
//!
//! @ref LLP 0044#byte-stores-and-resumable-transfer — configurations of one
//!   adapter, not product-specific storage APIs; each provider still earns
//!   an independent capability claim, so this module existing claims
//!   nothing: `assetLifecycleStores` stays `["local-fs"]` until a live
//!   endpoint qualification runs (see the qualification-drill ticket).
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

use crate::assets_store::{
    AssetObjectDigest, AssetObjectRef, AssetStore, ASSET_OBJECT_HEAD_BYTES,
};
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
    /// Reads the `SNAPBACK_ASSET_S3_*` environment configuration. Secrets
    /// arrive the same way other deployment configuration does and are
    /// never logged or echoed into diagnostics.
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

impl S3Transport for UreqTransport {
    fn execute(&self, request: S3Request) -> SnapbackResult<S3Response> {
        let mut call = ureq::request(request.method, &request.url);
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
            .read_to_end(&mut body)
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!("s3 transport read error: {error}"),
                )
            })?;
        Ok(S3Response { status, headers, body })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&sha2::Sha256::digest(bytes))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(key)
        .expect("hmac accepts any key length");
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

impl AssetS3Store {
    pub fn new(config: AssetS3Config, transport: Box<dyn S3Transport>) -> Self {
        Self {
            config,
            transport,
            now_ms: Box::new(|| std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)),
        }
    }

    pub fn with_clock(
        config: AssetS3Config,
        transport: Box<dyn S3Transport>,
        now_ms: Box<dyn Fn() -> i64 + Send + Sync>,
    ) -> Self {
        Self { config, transport, now_ms }
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
        let canonical_request = format!(
            "{method}\n{path}\n{canonical_query}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD"
        );
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

    fn get_object(&self, object_key: &str, range: Option<(u64, u64)>) -> SnapbackResult<S3Response> {
        let headers = match range {
            Some((start, end_inclusive)) => vec![(
                "range".to_owned(),
                format!("bytes={start}-{end_inclusive}"),
            )],
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
                "<Part><PartNumber>{number}</PartNumber><ETag>{etag}</ETag></Part>"
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
        let response =
            self.execute(self.sign("PUT", &object_key, &[], &[], bytes.to_vec()))?;
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
        let end_inclusive = offset + (max_len as u64) - 1;
        let response =
            self.get_object(&self.object_key(object), Some((offset, end_inclusive)))?;
        match response.status {
            200 | 206 => Ok(response.body),
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
            let response =
                self.execute(self.sign("DELETE", &object_key, &[], &[], Vec::new()))?;
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
