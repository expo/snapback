mod media;

const MAX_JSON_LINE_BYTES: usize = 4096;

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let (value, mut exit) = match media::run(&args) {
        Ok(value) => (value, 0),
        Err(refusal) => (
            serde_json::to_value(refusal).expect("media refusal is JSON"),
            2,
        ),
    };
    let mut line = serde_json::to_string(&value).expect("media response is JSON");
    if line.len() + 1 > MAX_JSON_LINE_BYTES {
        line =
            r#"{"code":"E_ASSET_TYPE","detail":"media helper response exceeded stdout ceiling"}"#
                .to_owned();
        exit = 2;
    }
    println!("{line}");
    if exit != 0 {
        std::process::exit(exit);
    }
}
