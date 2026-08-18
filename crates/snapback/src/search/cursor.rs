use crate::search::types::{SEARCH_CURSOR_MAX_BYTES, SEARCH_CURSOR_PROFILE, SearchCursorV1};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use sha2::Sha256;

fn associated_data(app_id: &str, target_profile_id: &str) -> Vec<u8> {
    let mut out = b"snapback:search-cursor:v1\n".to_vec();
    for value in [app_id.as_bytes(), target_profile_id.as_bytes()] {
        out.extend_from_slice(&(value.len() as u32).to_be_bytes());
        out.extend_from_slice(value);
    }
    out
}

fn derive_key(root: &[u8; 32], key_generation: &str) -> Option<[u8; 32]> {
    let hkdf = Hkdf::<Sha256>::new(
        Some(b"snapback:search-cursor:xchacha20:v1"),
        root.as_slice(),
    );
    let mut out = [0_u8; 32];
    hkdf.expand(key_generation.as_bytes(), &mut out).ok()?;
    Some(out)
}

pub fn mint(root: &[u8; 32], body: &SearchCursorV1) -> Result<String, &'static str> {
    let key = derive_key(root, &body.key_generation).ok_or("derive")?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| "random")?;
    let plaintext = serde_json::to_vec(body).map_err(|_| "serialize")?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &associated_data(&body.app_id, &body.target_profile_id),
            },
        )
        .map_err(|_| "encrypt")?;
    let mut payload = nonce.to_vec();
    payload.extend_from_slice(&ciphertext);
    let wire = format!("sbsc1.{}", URL_SAFE_NO_PAD.encode(payload));
    if wire.len() > SEARCH_CURSOR_MAX_BYTES {
        return Err("oversize");
    }
    Ok(wire)
}

pub fn decode(
    wire: &str,
    roots: &[(String, [u8; 32])],
    app_id: &str,
    target_profile_id: &str,
    now_ms: u64,
) -> Result<SearchCursorV1, &'static str> {
    if wire.len() > SEARCH_CURSOR_MAX_BYTES {
        return Err("restart");
    }
    let payload = wire.strip_prefix("sbsc1.").ok_or("restart")?;
    let payload = URL_SAFE_NO_PAD.decode(payload).map_err(|_| "restart")?;
    if payload.len() < 24 + 16 {
        return Err("restart");
    }
    let (nonce, ciphertext) = payload.split_at(24);
    for (generation, root) in roots {
        let Some(key) = derive_key(root, generation) else {
            continue;
        };
        let cipher = XChaCha20Poly1305::new((&key).into());
        let Ok(plaintext) = cipher.decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &associated_data(app_id, target_profile_id),
            },
        ) else {
            continue;
        };
        let Ok(body) = serde_json::from_slice::<SearchCursorV1>(&plaintext) else {
            continue;
        };
        if body.format_version != 1
            || body.app_id != app_id
            || body.target_profile_id != target_profile_id
            || body.key_generation != *generation
            || body.issued_at > now_ms
            || body.expires_at < now_ms
            || body.expires_at.saturating_sub(body.issued_at) > 120_000
        {
            continue;
        }
        return Ok(body);
    }
    Err("restart")
}

pub fn profile() -> &'static str {
    SEARCH_CURSOR_PROFILE
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body() -> SearchCursorV1 {
        SearchCursorV1 {
            format_version: 1,
            app_id: "app".into(),
            database_id: "db".into(),
            target_profile_id: "local-dev-sqlite-ibex".into(),
            stream_epoch: "stream".into(),
            semantic_version: "v1".into(),
            physical_generation: 1,
            query_core_hash: "sha256:q".into(),
            limit: 10,
            authority_instance: "auth".into(),
            owner_subject: Some("alice".into()),
            release_policy_digest: "sha256:p".into(),
            score: 100,
            row_id: "r".into(),
            row_id_direction: "asc".into(),
            key_generation: "k1".into(),
            issued_at: 100,
            expires_at: 120_100,
            membership_resource: None,
            membership_declaration: None,
            membership_roles: None,
            authorization_incarnation: None,
            authorization_epoch: None,
        }
    }

    #[test]
    fn aead_round_trip_and_identity_tampering_collapse() {
        let key = [7_u8; 32];
        let wire = mint(&key, &body()).unwrap();
        assert_ne!(wire, mint(&key, &body()).unwrap());
        let roots = vec![("k1".into(), key)];
        assert_eq!(
            decode(&wire, &roots, "app", "local-dev-sqlite-ibex", 1_000).unwrap(),
            body()
        );
        assert!(decode(&wire, &roots, "other", "local-dev-sqlite-ibex", 1_000).is_err());
        let mut tampered = wire.into_bytes();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(
            decode(
                std::str::from_utf8(&tampered).unwrap(),
                &roots,
                "app",
                "local-dev-sqlite-ibex",
                1_000
            )
            .is_err()
        );
    }

    #[test]
    fn pre_membership_json_cursor_plaintext_remains_decodable() {
        let mut legacy = serde_json::to_value(body()).unwrap();
        let object = legacy.as_object_mut().unwrap();
        for field in [
            "membershipResource",
            "membershipDeclaration",
            "membershipRoles",
            "authorizationIncarnation",
            "authorizationEpoch",
        ] {
            object.remove(field);
        }
        let decoded: SearchCursorV1 = serde_json::from_value(legacy).unwrap();
        assert_eq!(decoded.membership_resource, None);
        assert_eq!(decoded.membership_declaration, None);
        assert_eq!(decoded.membership_roles, None);
        assert_eq!(decoded.authorization_incarnation, None);
        assert_eq!(decoded.authorization_epoch, None);
    }
}
