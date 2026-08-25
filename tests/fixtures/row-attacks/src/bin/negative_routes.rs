use snapback_engine::local::ResolvedServiceAuthority;
use snapback_sync::auth::coordinator::PreparedBearerAuthority;
use snapback_sync::auth::invocation::{PreparedAuthority, ResolvedAppAuthority};

fn main() {
    let _ = PreparedAuthority::default();
    let _ = PreparedBearerAuthority::default();
    let _ = ResolvedServiceAuthority::default();

    let _: PreparedAuthority = ResolvedAppAuthority::Anonymous.into();
    let _: PreparedBearerAuthority = ResolvedAppAuthority::Anonymous.into();
    let _: ResolvedServiceAuthority = ResolvedAppAuthority::Anonymous.into();

    let _ = serde_json::to_value(Option::<PreparedAuthority>::None.unwrap());
    let _ = serde_json::to_value(Option::<PreparedBearerAuthority>::None.unwrap());
    let _ = serde_json::to_value(Option::<ResolvedServiceAuthority>::None.unwrap());
    let _ = serde_json::from_value::<PreparedAuthority>(serde_json::json!({}));
    let _ = serde_json::from_value::<PreparedBearerAuthority>(serde_json::json!({}));
    let _ = serde_json::from_value::<ResolvedServiceAuthority>(serde_json::json!({}));

    let _ = PreparedAuthority::builder();
    let _ = PreparedBearerAuthority::builder();
    let _ = ResolvedServiceAuthority::builder();
}
