use super::{card, guide};

#[test]
fn surf_cards_match_current_auth_rules_assets_and_protocol() {
    for name in ["personas","wire"] { assert!(card(name).unwrap().contains("Every call carries a principal; public visitors use guest sessions; `serve` accepts bearers only")); }
    let client=card("client").unwrap();assert!(!client.contains("`viewer`, `session`"));assert!(client.contains("secureStoreSessionStore(SecureStore)"));assert!(client.contains("absent` can be an authorised empty list"));
    assert!(card("rules").unwrap().contains("insert returns E_UNIQUE naming the declared key"));
    assert!(!card("rules").unwrap().contains("insert returns E_CONSTRAINT naming the index"));
    assert!(card("rules").unwrap().contains("What a refused write returns: E_RULE, NOT_FOUND, E_UNIQUE, E_CONSTRAINT"));
    let assets=card("assets").unwrap();assert!(assets.contains("client.upload transfers bytes online"));assert!(assets.contains("argument: \"photo\", waitSeconds: 0"));assert!(!assets.contains("Uploads are online only; there is nothing to queue"));
    let production=card("production").unwrap();assert!(production.find("minimal production bar").unwrap()<production.find("Profiles, private pickers").unwrap());assert!(production.contains("Invitation UI by shared principal"));
    let testing=card("testing").unwrap();for text in ["Raw HTTP proof across releases","404","E_OP","state:\"failed\", why","SDK, not raw HTTP"] {assert!(testing.contains(text),"{text}");}
    assert_eq!(guide::resolve("produc"),Some("production"));assert_eq!(guide::resolve("pr"),None);
}
