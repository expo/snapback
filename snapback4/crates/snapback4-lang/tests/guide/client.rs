use super::card;

#[test]
fn client_aliases_keep_typing_on_ephemeral() {
    let client = card("client").unwrap();
    assert!(client.lines().count() <= 130);
    for alias in ["client", "react", "hooks", "composer", "unread"] {
        assert_eq!(card(alias), Some(client));
        assert!(snapback4_lang::guide::listing().contains(alias));
    }
    assert_eq!(card("typing"), card("ephemeral"));
}
