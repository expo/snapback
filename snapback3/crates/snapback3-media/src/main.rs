mod capability_fixtures;
mod codec;
mod image_walk;
mod media;
mod memory;
mod protocol;
mod video_walk;

const MAX_JSON_LINE_BYTES: usize = 4096;

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let result = memory::install().and_then(|_| media::run(&args));
    let (value, mut exit) = match result {
        Ok(value) => (value, 0),
        Err(refusal) => (
            serde_json::to_value(refusal).expect("media refusal is JSON"),
            2,
        ),
    };
    let mut line = serde_json::to_string(&value).expect("media response is JSON");
    if line.len() + 1 > MAX_JSON_LINE_BYTES {
        line = r#"{"code":"E_ASSET_TYPE","family":"input","message":"media helper response exceeded stdout ceiling","rewrite":"retry with supported media","site":"assets/admission"}"#.to_owned();
        exit = 2;
    }
    println!("{line}");
    if exit != 0 {
        std::process::exit(exit);
    }
}
