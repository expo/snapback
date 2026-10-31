//! `serve --trusted-proxy`: the hops whose `X-Forwarded-For` names the client
//! for identity rate keys. Behind a TLS proxy every connection's socket peer is
//! the proxy, so without this every sign-in shares one per-peer budget.
//!
//! Only the per-peer rate key reads the header, and only when the socket peer
//! is a declared proxy. Loopback-derived development identity (personas, dev
//! doors, token minting) always keeps the socket peer: a proxy never grants it.
use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TrustedProxies {
    nets: Vec<(IpAddr, u8)>,
}

pub const FLAG: &str = "trusted-proxy";
pub const VARIABLE: &str = "SNAPBACK4_TRUSTED_PROXY";
const HEADER: &str = "x-forwarded-for";

impl TrustedProxies {
    /// `--trusted-proxy a,b/24` wins over `SNAPBACK4_TRUSTED_PROXY`; each entry
    /// is a literal IP or CIDR network. Empty means no proxy is trusted.
    pub fn from_options(flags: &BTreeMap<String, String>, env: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let (source, text) = match (flags.get(FLAG), env(VARIABLE)) {
            (Some(text), _) => (format!("--{FLAG}"), text.clone()),
            (None, Some(text)) => (VARIABLE.to_owned(), text),
            (None, None) => return Ok(Self::default()),
        };
        Self::parse(&text).map_err(|entry| format!("E_INPUT: {source} takes literal IP addresses or CIDR networks separated by commas (for example 127.0.0.1,10.0.0.0/8), not {entry:?}; see snapback4 guide release-json --section proxies"))
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        let mut nets = Vec::new();
        for entry in text.split(',').map(str::trim).filter(|e| !e.is_empty()) {
            let (address, bits) = match entry.split_once('/') {
                Some((address, bits)) => (address, Some(bits)),
                None => (entry, None),
            };
            let address: IpAddr = address.parse().map_err(|_| entry.to_owned())?;
            let width = if address.is_ipv4() { 32 } else { 128 };
            let bits = match bits {
                None => width,
                Some(bits) => bits.parse::<u8>().ok().filter(|b| *b <= width).ok_or_else(|| entry.to_owned())?,
            };
            nets.push((address, bits));
        }
        if nets.is_empty() { return Err(text.trim().to_owned()); }
        Ok(Self { nets })
    }

    pub fn is_empty(&self) -> bool { self.nets.is_empty() }

    pub fn contains(&self, ip: IpAddr) -> bool {
        let ip = canonical(ip);
        self.nets.iter().any(|(net, bits)| {
            let net = canonical(*net);
            match (ip, net) {
                (IpAddr::V4(ip), IpAddr::V4(net)) => masked(u32::from(ip) as u128, *bits, 32) == masked(u32::from(net) as u128, *bits, 32),
                (IpAddr::V6(ip), IpAddr::V6(net)) => masked(u128::from(ip), *bits, 128) == masked(u128::from(net), *bits, 128),
                _ => false,
            }
        })
    }

    /// The address a rate key names. A connection from a trusted proxy is
    /// keyed by the rightmost `X-Forwarded-For` hop that is not itself a
    /// trusted proxy; anything else (no proxy, no header, an unparseable
    /// entry, a chain made only of proxies) keys the socket peer.
    pub fn client_ip(&self, peer: Option<SocketAddr>, forwarded: impl Iterator<Item = impl AsRef<str>>) -> Option<IpAddr> {
        let peer = peer.map(|p| p.ip());
        let Some(peer_ip) = peer else { return None };
        if self.is_empty() || !self.contains(peer_ip) { return peer; }
        let mut hops: Vec<IpAddr> = Vec::new();
        for header in forwarded {
            for hop in header.as_ref().split(',') {
                let hop = hop.trim().trim_matches('"');
                // Plain, `[v6]`, `[v6]:port` and `v4:port` spellings all name one address.
                let parsed = hop.parse::<IpAddr>().ok()
                    .or_else(|| hop.parse::<SocketAddr>().ok().map(|s| s.ip()))
                    .or_else(|| hop.strip_prefix('[').and_then(|h| h.strip_suffix(']')).and_then(|h| h.parse::<IpAddr>().ok()));
                match parsed {
                    Some(ip) => hops.push(ip),
                    None => return peer,
                }
            }
        }
        hops.iter().rev().find(|hop| !self.contains(**hop)).copied().or(peer)
    }

    pub fn rate_key(&self, request: &impl crate::serve::RequestInfo) -> String {
        let forwarded = request.headers().iter()
            .filter(|h| h.field.as_str().as_str().eq_ignore_ascii_case(HEADER))
            .map(|h| h.value.as_str().to_owned())
            .collect::<Vec<_>>();
        self.client_ip(request.remote_addr().copied(), forwarded.iter())
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "unknown".into())
    }

    /// The startup line a release prints once.
    pub fn startup_line(&self) -> Option<String> {
        if self.is_empty() { return None; }
        let list = self.nets.iter().map(|(ip, bits)| format!("{ip}/{bits}")).collect::<Vec<_>>().join(", ");
        Some(format!("proxies   trusted for identity rate keys (X-Forwarded-For): {list}"))
    }
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
        v4 => v4,
    }
}

fn masked(value: u128, bits: u8, width: u8) -> u128 {
    if bits == 0 { 0 } else { value >> (width - bits) }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn flags(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
    }
    fn sock(text: &str) -> Option<SocketAddr> { Some(text.parse().unwrap()) }
    fn ip(text: &str) -> Option<IpAddr> { Some(text.parse().unwrap()) }

    #[test]
    fn flag_wins_over_the_variable_and_malformed_entries_refuse() {
        let none = |_: &str| None;
        assert!(TrustedProxies::from_options(&flags(&[]), none).unwrap().is_empty());
        let env = |name: &str| (name == VARIABLE).then(|| "10.0.0.0/8".to_owned());
        assert!(TrustedProxies::from_options(&flags(&[]), env).unwrap().contains(ip("10.9.8.7").unwrap()));
        let proxies = TrustedProxies::from_options(&flags(&[(FLAG, "127.0.0.1")]), env).unwrap();
        assert!(!proxies.contains(ip("10.9.8.7").unwrap()), "a flag wins over its variable");
        for bad in ["proxy", "10.0.0.0/33", "::1/129", "", " , "] {
            let error = TrustedProxies::from_options(&flags(&[(FLAG, bad)]), none).unwrap_err();
            assert!(error.starts_with("E_INPUT: --trusted-proxy"), "{error}");
        }
    }

    #[test]
    fn only_a_trusted_peer_is_keyed_by_the_forwarded_client() {
        let proxies = TrustedProxies::parse("127.0.0.1, 10.0.0.0/8, ::1").unwrap();
        let header = |text: &str| vec![text.to_owned()];
        // The proxy's connection keys the real client.
        assert_eq!(proxies.client_ip(sock("127.0.0.1:5000"), header("203.0.113.9").iter()), ip("203.0.113.9"));
        // The rightmost hop that is not a proxy; a client's own spoofed prefix is ignored.
        assert_eq!(proxies.client_ip(sock("10.1.2.3:5000"), header("1.1.1.1, 203.0.113.9, 10.0.0.2").iter()), ip("203.0.113.9"));
        // Two headers in order behave like one chain.
        assert_eq!(proxies.client_ip(sock("[::1]:5000"), ["203.0.113.9", "10.0.0.2"].iter()), ip("203.0.113.9"));
        // IPv6 hops, bracketed hops with ports, and IPv4-mapped peers parse.
        assert_eq!(proxies.client_ip(sock("[::1]:5000"), header("[2001:db8::7]:443").iter()), ip("2001:db8::7"));
        assert_eq!(proxies.client_ip(sock("[::1]:5000"), header("[2001:db8::7]").iter()), ip("2001:db8::7"));
        assert_eq!(proxies.client_ip(sock("[::1]:5000"), header("2001:db8::7").iter()), ip("2001:db8::7"));
        assert_eq!(proxies.client_ip(sock("[::ffff:127.0.0.1]:5000"), header("203.0.113.9:1234").iter()), ip("203.0.113.9"));
        // A direct connection from an untrusted peer ignores the header entirely.
        assert_eq!(proxies.client_ip(sock("198.51.100.4:5000"), header("203.0.113.9").iter()), ip("198.51.100.4"));
        // No header, an unparseable hop, or a chain of only proxies keys the peer.
        let empty: Vec<String> = Vec::new();
        assert_eq!(proxies.client_ip(sock("127.0.0.1:5000"), empty.iter()), ip("127.0.0.1"));
        assert_eq!(proxies.client_ip(sock("127.0.0.1:5000"), header("unknown, 203.0.113.9").iter()), ip("127.0.0.1"));
        assert_eq!(proxies.client_ip(sock("127.0.0.1:5000"), header("10.0.0.2").iter()), ip("127.0.0.1"));
        // Nothing trusted: the peer, always.
        assert_eq!(TrustedProxies::default().client_ip(sock("127.0.0.1:5000"), header("203.0.113.9").iter()), ip("127.0.0.1"));
        assert_eq!(proxies.client_ip(None, header("203.0.113.9").iter()), None);
    }
}
