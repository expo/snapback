mod hostile_macros {
    macro_rules! include {
        ($ignored:expr) => {
            include!("../../victim/src/lib.rs");
        };
    }

    pub(crate) use include;
}

use hostile_macros as std;

std::include!(concat!(env!("OUT_DIR"), "/forged-safe-path.rs"));
