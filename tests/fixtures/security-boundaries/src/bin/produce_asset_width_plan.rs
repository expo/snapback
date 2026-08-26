use snapback_services::assets::{AssetFsStore, AssetWidthPrepareTicketV1};
use std::{path::Path, sync::Arc};

fn main() {
    let store = Arc::new(AssetFsStore::open(Path::new("asset-width-fixture")).unwrap());
    // @attack
    let _ = AssetWidthPrepareTicketV1::new(
        "caller-asset".to_owned(),
        "width/313".to_owned(),
        313,
        "caller-source".to_owned(),
        "image/png".to_owned(),
        store,
        "caller-app".to_owned(),
        u64::MAX,
    )
    .prepare();
}
