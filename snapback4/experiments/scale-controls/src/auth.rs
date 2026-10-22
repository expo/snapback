//! HS256 identity boundary for the typed-table HTTP control.
use anyhow::{Context, Result};
use axum::http::HeaderMap;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;
use std::{fs, os::unix::fs::PermissionsExt};

pub struct Verifier {
    key: DecodingKey,
    validation: Validation,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    role: String,
}

impl Verifier {
    pub fn from_env() -> Result<Self> {
        let path = std::env::var("SCALE_JWT_SECRET_FILE").context("set SCALE_JWT_SECRET_FILE")?;
        anyhow::ensure!(
            fs::metadata(&path)?.permissions().mode() & 0o777 == 0o600,
            "JWT secret file must be mode 600"
        );
        let secret = fs::read(path)?;
        anyhow::ensure!(secret.len() >= 32, "HS256 key must be at least 32 bytes");
        Ok(Self::new(&secret))
    }

    fn new(secret: &[u8]) -> Self {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
        validation.set_audience(&["authenticated"]);
        validation.set_issuer(&["supabase"]);
        validation.leeway = 0;
        validation.validate_nbf = true;
        Self {
            key: DecodingKey::from_secret(secret),
            validation,
        }
    }

    // @ref LLP 3000.009.001.002#4-controls — authenticate every call before SQL authorization; never trust the JSON principal
    pub fn principal(&self, headers: &HeaderMap) -> Option<i64> {
        let token = headers
            .get(axum::http::header::AUTHORIZATION)?
            .to_str()
            .ok()?
            .strip_prefix("Bearer ")?;
        let claims = decode::<Claims>(token, &self.key, &self.validation)
            .ok()?
            .claims;
        if claims.role != "authenticated" {
            return None;
        }
        // Same canonical fixture UUID -> numeric user mapping as Supabase users.auth_id.
        let suffix = claims.sub.strip_prefix("00000000-0000-0000-0000-")?;
        if suffix.len() != 12 || !suffix.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let principal = i64::from_str_radix(suffix, 16).ok()?.checked_sub(1)?;
        (0..256).contains(&principal).then_some(principal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode};
    use serde_json::{Value, json};

    #[test]
    fn authenticates_identity_and_rejects_untrusted_claims() {
        let secret = b"test-only-32-byte-signing-key-0000";
        let verifier = Verifier::new(secret);
        let claims = json!({"sub":"00000000-0000-0000-0000-000000000080",
            "role":"authenticated","aud":"authenticated","iss":"supabase",
            "iat":1,"exp":4102444800_u64});
        let headers = |v: &Value, key: &[u8], alg| {
            let token = encode(&Header::new(alg), v, &EncodingKey::from_secret(key)).unwrap();
            let mut h = HeaderMap::new();
            h.insert("authorization", format!("Bearer {token}").parse().unwrap());
            h
        };
        assert_eq!(
            verifier.principal(&headers(&claims, secret, Algorithm::HS256)),
            Some(127)
        );
        assert_eq!(verifier.principal(&HeaderMap::new()), None);
        assert_eq!(
            verifier.principal(&headers(
                &claims,
                b"different-test-signing-key-000000",
                Algorithm::HS256
            )),
            None
        );
        assert_eq!(
            verifier.principal(&headers(&claims, secret, Algorithm::HS384)),
            None
        );
        for (field, value) in [
            ("exp", json!(1)),
            ("nbf", json!(4102444800_u64)),
            ("aud", json!("other")),
            ("iss", json!("other")),
            ("role", json!("service_role")),
            ("sub", json!("00000000-0000-0000-0000-000000000000")),
            ("sub", json!("00000000-0000-0000-0000-000000000101")),
            ("sub", json!("invalid")),
        ] {
            let mut invalid = claims.clone();
            invalid[field] = value;
            assert_eq!(
                verifier.principal(&headers(&invalid, secret, Algorithm::HS256)),
                None,
                "{field}"
            );
        }
        for field in ["exp", "sub", "aud", "iss", "role"] {
            let mut invalid = claims.clone();
            invalid.as_object_mut().unwrap().remove(field);
            assert_eq!(
                verifier.principal(&headers(&invalid, secret, Algorithm::HS256)),
                None,
                "{field}"
            );
        }
    }
}
