//! `--port` for the verbs that listen (`dev`, `serve`): `N`, `0` (a free
//! port the server prints), or `A-B` (the first free port of an inclusive
//! range). A farm or CI host assigns each builder a range; agents wrote their
//! own scanners, two of which hung. Anything else refuses `E_INPUT` before any
//! socket work: `serve --port 20990-20995` used to parse as nothing and
//! silently listen on 4400 (wave 8 DT3, 30 lanes).
// @ref LLP 3000.036#15.9 — a port range binds its first free port; every port taken is E_ADDRINUSE.

use std::net::{IpAddr, TcpListener};

/// What `--port` asked for, checked before any socket work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Port {
    One(u16),
    Range(u16, u16),
}

pub(crate) const DEFAULT: u16 = 4400;

/// Parse `--port` for `verb`; no flag is the default port.
pub(crate) fn parse(verb: &str, flag: Option<&str>) -> Result<Port, String> {
    let Some(text) = flag else { return Ok(Port::One(DEFAULT)); };
    let Some((low, high)) = text.split_once('-') else {
        return text.trim().parse::<u16>().map(Port::One)
            .map_err(|_| format!("E_INPUT: {verb} --port takes a port (0 picks a free one) or a range A-B (the first free port in it), not {text:?}"));
    };
    let range = |part: &str| part.trim().parse::<u16>().ok().filter(|port| *port > 0);
    let (Some(low), Some(high)) = (range(low), range(high)) else {
        return Err(format!("E_INPUT: {verb} --port {text}: a range is two ports from 1 to 65535, low-high, for example --port 20100-20109"));
    };
    if low > high { return Err(format!("E_INPUT: {verb} --port {text}: the range runs from low to high; write --port {high}-{low}")); }
    Ok(Port::Range(low, high))
}

/// The port to serve on and, for a range on loopback, its listener held from
/// the first free probe to the server, so no other process can take the port
/// in between. The URL stays stdout's first line.
pub(crate) fn listen(verb: &str, port: Port, bind: IpAddr, inherited: Option<TcpListener>) -> Result<(u16, Option<TcpListener>), String> {
    let (low, high) = match port {
        Port::One(port) => return Ok((port, inherited)),
        Port::Range(low, high) => (low, high),
    };
    if inherited.is_some() { return Err(format!("{verb} --port A-B cannot combine with an inherited listener")); }
    for port in low..=high {
        match TcpListener::bind((bind, port)) {
            // A loopback listener is handed over bound; a wildcard bind keeps the
            // server's own listen path (it refuses an inherited non-loopback socket).
            Ok(listener) if bind.is_loopback() => return Ok((port, Some(listener))),
            Ok(listener) => { drop(listener); return Ok((port, None)); }
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse || error.kind() == std::io::ErrorKind::PermissionDenied => continue,
            Err(error) => return Err(format!("{verb} --port {low}-{high}: cannot listen on {bind}:{port}: {error}")),
        }
    }
    Err(format!("E_ADDRINUSE: every port in {low}-{high} on {bind} is in use; widen the range, stop a {verb} you started (its SNAPBACK4_READY line names its pid), or use --port 0"))
}

#[cfg(test)]
mod tests {
    use super::{Port, listen, parse};

    #[test]
    fn a_port_range_binds_its_first_free_port_and_refuses_when_full() {
        let loopback = std::net::IpAddr::from([127, 0, 0, 1]);
        let held = std::net::TcpListener::bind((loopback, 0)).unwrap();
        let taken = held.local_addr().unwrap().port();
        // A range starting at a taken port moves on to a free one (or refuses when none is free).
        let range = parse("dev", Some(&format!("{taken}-{}", taken.saturating_add(20)))).unwrap();
        let (port, listener) = listen("dev", range, loopback, None).unwrap();
        assert!(port > taken && port <= taken.saturating_add(20), "{port}");
        assert_eq!(listener.unwrap().local_addr().unwrap().port(), port, "the chosen port is held, not probed and dropped");
        let full = listen("serve", Port::Range(taken, taken), loopback, None).unwrap_err();
        assert!(full.starts_with("E_ADDRINUSE: every port in") && full.contains("stop a serve"), "{full}");
    }

    #[test]
    fn every_listening_verb_parses_one_port_zero_a_range_or_refuses_e_input() {
        for verb in ["dev", "serve"] {
            assert_eq!(parse(verb, None).unwrap(), Port::One(4400));
            assert_eq!(parse(verb, Some("0")).unwrap(), Port::One(0));
            assert_eq!(parse(verb, Some("20991")).unwrap(), Port::One(20991));
            assert_eq!(parse(verb, Some("20990-20995")).unwrap(), Port::Range(20990, 20995));
            for bad in ["abc", "99999", "-1", "", "20109-20100", "0-5", "1-x", "20990-99999"] {
                let refusal = parse(verb, Some(bad)).unwrap_err();
                assert!(refusal.starts_with(&format!("E_INPUT: {verb} --port")), "{bad:?}: {refusal}");
                assert!(!refusal.contains("4400"), "{bad:?}: the refusal names the input, never a substituted default: {refusal}");
            }
        }
    }
}
