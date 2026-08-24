fn main() {
    // @attack
    let _ = snapback_server::server::commit_capsule::CommitCapsuleRuntimeBinding::new(
        panic!("compile-only shared state"),
        panic!("compile-only admission controller"),
        panic!("compile-only graph identity"),
        panic!("compile-only commit origin"),
    );
}
