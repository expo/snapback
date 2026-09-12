//! The Snapback 4 binary. Week one: only `--version` and `doctor` exist, and
//! `doctor` says so honestly. See LLP 3000 §5 for what arrives each week.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => println!("snapback4 {}", env!("CARGO_PKG_VERSION")),
        Some("doctor") => {
            println!("snapback4 {}: no owner, no store, no compiler yet (LLP 3000 §5, week 1)", env!("CARGO_PKG_VERSION"));
        }
        _ => {
            eprintln!("usage: snapback4 --version | doctor");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_the_workspace_version() {
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.1");
    }
}
