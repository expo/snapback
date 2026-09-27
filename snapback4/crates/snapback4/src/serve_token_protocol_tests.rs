use super::*;

fn mint() -> Mint { Mint { service: "ranker".into(), days: 2, store: "store".into() } }
fn authority() -> Authority { Authority::new("a".repeat(64), "store".into()) }

#[test]
fn known_hmac_vectors_and_direction_separation() {
    // Independent Python stdlib hmac/SHA-256 calculation, pinned here.
    let binding = mint().binding();
    assert_eq!(binding, br#"[1,"ranker",2,"store"]"#);
    let server = server_proof(&"a".repeat(64), &[1; 32], &[2; 32], &binding);
    assert_eq!(server, "3d9c13aa46297912a504432df127d411ebcba57e721292cc0fbfb72a812bce35");
    let client = client_proof(&"a".repeat(64), &[1; 32], &[2; 32], &binding);
    assert_eq!(client, "e599b65ba2f99c5cafdb455d753f46eb778023e58400f132942b33ccd41390dc");
    assert!(verify_server(&"a".repeat(64), &[1; 32], &[2; 32], &binding, &server));
    assert!(!verify_server(&"a".repeat(64), &[1; 32], &[2; 32], &binding, &client));
    // Functional mismatches at every byte, not a noisy wall-clock timing claim.
    for i in 0..32 {
        let mut tag = nonce(&server).unwrap(); tag[i] ^= 1;
        assert!(!verify_server(&"a".repeat(64), &[1; 32], &[2; 32], &binding, &hex(&tag)));
    }
}

#[test]
fn nonce_is_single_use_even_after_invalid_proof_or_transcript() {
    let authority = authority(); let now = Instant::now(); let binding = mint().binding();
    for variant in 0..8 {
        let server = authority.challenge([1; 32], binding.clone(), now).unwrap();
        let good = client_proof(&authority.secret, &[1; 32], &server, &binding);
        let mut changed = mint();
        match variant { 2 => changed.service = "other".into(), 3 => changed.days += 1, 4 => changed.store = "other".into(), _ => () }
        let mut client = [1; 32]; if variant == 5 { client[0] ^= 1; }
        let proof = match variant {
            0 => good.clone(), 1 => "0".repeat(64),
            6 => server_proof(&authority.secret, &client, &server, &binding),
            7 => good[..63].into(), _ => good.clone(),
        };
        assert_eq!(authority.consume(&client, &server, &changed.binding(), &proof, now), variant == 0);
        assert!(!authority.consume(&[1; 32], &server, &binding, &good, now));
    }
}

#[test]
fn expiry_and_pending_capacity_use_monotonic_time_without_sleep() {
    let authority = authority(); let now = Instant::now(); let binding = mint().binding();
    for _ in 0..MAX_PENDING { authority.challenge([1; 32], binding.clone(), now).unwrap(); }
    assert!(authority.challenge([1; 32], binding.clone(), now).is_none());
    let expired = *authority.pending.lock().unwrap().keys().next().unwrap();
    let proof = client_proof(&authority.secret, &[1; 32], &expired, &binding);
    assert!(!authority.consume(&[1; 32], &expired, &binding, &proof, now + TTL));
    let fresh = authority.challenge([1; 32], binding.clone(), now + TTL).unwrap();
    assert_eq!(authority.pending.lock().unwrap().len(), 1);
    let proof = client_proof(&authority.secret, &[1; 32], &fresh, &binding);
    assert!(authority.consume(&[1; 32], &fresh, &binding, &proof, now + TTL + Duration::from_millis(1)));
}

#[test]
fn concurrent_completion_has_exactly_one_winner() {
    let authority = std::sync::Arc::new(authority()); let now = Instant::now(); let binding = mint().binding();
    let server = authority.challenge([1; 32], binding.clone(), now).unwrap();
    let proof = client_proof(&authority.secret, &[1; 32], &server, &binding);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let threads: Vec<_> = (0..8).map(|_| {
        let (authority, binding, proof, barrier) = (authority.clone(), binding.clone(), proof.clone(), barrier.clone());
        std::thread::spawn(move || { barrier.wait(); authority.consume(&[1; 32], &server, &binding, &proof, now) })
    }).collect();
    assert_eq!(threads.into_iter().map(|t| usize::from(t.join().unwrap())).sum::<usize>(), 1);
}

#[test]
fn replies_require_the_secret_and_exact_transcript_and_authenticate_all_bytes() {
    let key = "a".repeat(64); let binding = mint().binding(); let body = br#"{"session":{"token":"secret bearer"}}"#;
    let sealed = seal(&key, &[1; 32], &[2; 32], &binding, body).unwrap();
    assert_eq!(open(&key, &[1; 32], &[2; 32], &binding, &sealed).unwrap(), body);
    assert!(open(&"b".repeat(64), &[1; 32], &[2; 32], &binding, &sealed).is_none());
    assert!(open(&key, &[3; 32], &[2; 32], &binding, &sealed).is_none());
    assert!(open(&key, &[1; 32], &[3; 32], &binding, &sealed).is_none());
    assert!(open(&key, &[1; 32], &[2; 32], b"another request", &sealed).is_none());
    let bytes = unhex(&sealed).unwrap();
    for i in 0..bytes.len() {
        let mut corrupt = bytes.clone(); corrupt[i] ^= 1;
        assert!(open(&key, &[1; 32], &[2; 32], &binding, &hex(&corrupt)).is_none());
    }
}
