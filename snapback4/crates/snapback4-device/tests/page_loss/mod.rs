use super::loss_fixture as fixture;
use crate::common::*;
use snapback4_device::device::Device;

fn device<H: Host>(host: &mut H, source: &str, scopes: [usize; 2]) -> Device<H::Store> {
    let (mut engine, mut backend) = compile(source);
    for program in &mut backend.programs { fixture::repeat_owned_site(program); }
    engine.seed(fixture::rows(scopes)).unwrap();
    static OPENED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let name = format!("loss-{}", OPENED.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let mut device = host.open(&name, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    device
}

macro_rules! case {
    ($test:ident, $op:literal, $a:literal, $b:literal) => {
        mod $test {
            use super::*;
            fn run<H: Host>(host: &mut H) {
                fixture::check($op, [$a, $b], device(host, fixture::SOURCE, [$a, $b]).query($op, "dev:alice", &serde_json::json!({}), 100).unwrap());
            }
            #[test]
            fn sqlite() { run(&mut Sqlite::new(stringify!($test))); }
            #[test]
            fn memory() { run(&mut Memory::new()); }
        }
    };
}

case!(interrupted_twice_4_1, "interruptedTwice", 4, 1);
case!(interrupted_twice_5_0, "interruptedTwice", 5, 0);
case!(interrupted_twice_0_5, "interruptedTwice", 0, 5);
case!(interrupted_twice_1_1, "interruptedTwice", 1, 1);
case!(still_whole_4, "stillWhole", 4, 0);
case!(still_whole_5, "stillWhole", 5, 0);
case!(still_whole_6, "stillWhole", 6, 0);
case!(different_result_4, "differentResult", 4, 0);
case!(different_result_1, "differentResult", 1, 0);
case!(whole_and_different_4, "wholeAndDifferent", 4, 0);
case!(whole_and_different_6, "wholeAndDifferent", 6, 0);
case!(auxiliary_field, "auxiliaryField", 4, 0);
case!(auxiliary_finishes, "auxiliaryFinishes", 6, 0);
case!(auxiliary_breaks, "auxiliaryBreaks", 4, 0);
case!(overwritten_collector, "overwrittenCollector", 4, 0);
case!(direct_return_4, "directReturn", 4, 0);
case!(direct_return_1, "directReturn", 1, 0);
case!(direct_return_0, "directReturn", 0, 0);
case!(repeated_count_loses_first_cursor, "repeatedCount", 6, 0);
case!(repeated_count_exhausted, "repeatedCount", 5, 0);

fn generated<H: Host>(host: &mut H) {
    let mut cases = 0;
    for shape in fixture::shapes() {
        let source = fixture::generated(shape);
        for a in 0..=7 {
            for b in 0..=7 {
                let mut device = device(host, &source, [a, b]);
                let read = device.query("generated", "dev:alice", &serde_json::json!({}), 100).unwrap();
                fixture::oracle(shape, [a, b], read);
                cases += 1;
                drop(device);
            }
        }
    }
    println!("generated row coverage/{}: {cases} cases", host.label());
}

#[test]
fn generated_row_coverage_sqlite() { generated(&mut Sqlite::new("generated-loss")); }
#[test]
fn generated_row_coverage_memory() { generated(&mut Memory::new()); }

fn repeated_owned<H: Host>(host: &mut H) {
    for scopes in [[4, 7], [6, 1], [6, 7], [7, 0], [0, 7]] {
        let mut device = device(host, fixture::SOURCE, scopes);
        let repeated = device.query("ownedAgain", "dev:alice", &serde_json::json!({}), 100).unwrap();
        let last = device.query("ownedOnly", "dev:alice", &serde_json::json!({}), 100).unwrap();
        fixture::check_owned(scopes, repeated, last);
    }
}

#[test]
fn repeated_owned_site_keeps_only_last_cursor_sqlite() { repeated_owned(&mut Sqlite::new("repeated-owned")); }
#[test]
fn repeated_owned_site_keeps_only_last_cursor_memory() { repeated_owned(&mut Memory::new()); }
