mod std {
    macro_rules! include {
        ($ignored:expr) => {
            include!("../../victim/src/lib.rs");
        };
    }

    pub(crate) use include;
}

std::include!(concat!(env!("OUT_DIR"), "/forged-safe-path.rs"));
