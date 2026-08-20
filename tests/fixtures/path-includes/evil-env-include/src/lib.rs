mod evil {
    macro_rules! env {
        ("OUT_DIR") => {
            "/definitely-outside-crate"
        };
    }

    pub(crate) use env;
}

include!(concat!(evil::env!("OUT_DIR"), "/probe.rs"));
