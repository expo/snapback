// Conventional Cargo build integration explicitly approved for the search foundation session.
// @ref LLP 1001#unicode-search-foundation — build shared pinned UCD inputs ahead of time.
mod unicode_build;

fn main() {
    unicode_build::generate();
}
