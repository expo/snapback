use snapback_auth::auth::admission::AdmissionController;
use std::time::Instant;

#[test]
#[should_panic(expected = "auth lock-rank inversion")]
fn mode_publication_guard_rejects_stream_fence_inversion() {
    let controller = AdmissionController::new(7, true).unwrap();
    let lease = controller.admit().unwrap();
    let _mode = lease.effect_guard("intentional inverse").unwrap();
    let (_, publication) =
        crate::auth::session_projection::FencedPublication::anonymous_for_unmanaged_dev_connection();
    let _ = publication.try_publish(0, Instant::now(), || Ok(()));
}
