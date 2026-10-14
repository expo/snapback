use super::*;

#[test]
fn deploy_recipe_bootstraps_an_admin_without_a_public_privilege_race() {
    let text = card("deploy").unwrap();
    assert!(text.lines().count() <= 150, "keep the day-two card compact");
    for alias in ["release", "serve", "migration", "migrate", "rollback", "identity", "signup", "sign-up", "signin", "login", "register", "tokens", "admin"] {
        assert_eq!(card(alias), Some(text), "{alias}");
    }
    assert!(card("production").unwrap().contains("persona demo"));
    let admin = guide::alias_landing("admin", "deploy", text).unwrap();
    assert!(admin.contains("First admin") && admin.contains("token --service ops"), "{admin}");
    let bound = clean("production admin", &quarry(text)[0]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let input = |who: &str| args(&[("principal", Value::Id(who.into()))]);
    let public = engine.mutate("grantAdmin", None, Context::new("user:alice", input("user:alice"))).unwrap();
    assert!(matches!(public.state, WriteState::Failed { .. }));
    sent(&engine.mutate("grantAdmin", None, Context::new("service:ops", input("user:alice"))).unwrap());
    sent(&engine.mutate("grantAdmin", None, Context::new("user:alice", input("user:bob"))).unwrap());
    let repeated = engine.mutate("grantAdmin", None, Context::new("service:ops", input("user:alice"))).unwrap();
    assert!(matches!(repeated.state, WriteState::Failed { .. }));
    assert_eq!(engine.store().rows("admins").unwrap().len(), 2);
}
