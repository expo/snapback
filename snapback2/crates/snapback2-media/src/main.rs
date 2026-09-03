mod media;

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match media::run(&args) {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string(&value).expect("media success is JSON")
            );
        }
        Err(refusal) => {
            println!(
                "{}",
                serde_json::to_string(&refusal).expect("media refusal is JSON")
            );
            std::process::exit(2);
        }
    }
}
