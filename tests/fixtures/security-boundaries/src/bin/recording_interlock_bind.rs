use snapback_kernel::auth::service_fence::RecordingServiceAuthorityCommitInterlock;
use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let authority = database.claim_kernel_commit_authority().unwrap();
    let recording = RecordingServiceAuthorityCommitInterlock::default();
    // @attack
    let _ = recording.bind(&authority);
}
