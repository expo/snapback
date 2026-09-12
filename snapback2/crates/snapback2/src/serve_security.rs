//! Admission for browser requests happens before identity lookup or body parsing.
// @ref LLP 1002#4-the-wire — development browser origins never carry persona authority.
#[cfg(test)]
use super::header_value;
use super::{Request, header};
use crate::protocol::Refusal;
use subtle::ConstantTimeEq;

pub(super) fn secret_matches(provided: Option<&str>, expected: &str) -> bool {
    provided.is_some_and(|provided| bool::from(provided.as_bytes().ct_eq(expected.as_bytes())))
}

fn loopback_origin(origin: &str) -> bool {
    let Some(authority) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };
    if authority.contains(['/', '?', '#', '@', '\\']) {
        return false;
    }
    if authority == "localhost" || authority == "127.0.0.1" || authority == "[::1]" {
        return true;
    }
    if let Some(port) = authority.strip_prefix("localhost:") {
        return port.parse::<u16>().is_ok_and(|port| port != 0);
    }
    authority
        .parse::<std::net::SocketAddr>()
        .is_ok_and(|address| address.ip().is_loopback() && address.port() != 0)
}

pub(crate) fn cors_origin(request: &Request, mode: &str) -> Option<String> {
    let origin = header(request, "Origin")?;
    (mode == "dev" && loopback_origin(&origin)).then_some(origin)
}

pub(super) fn cors_lines(request: &Request, mode: &str) -> String {
    cors_origin(request, mode)
        .map(|origin| format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"))
        .unwrap_or_default()
}

pub(super) fn browser_admission(request: &Request, mode: &str) -> Result<(), Refusal> {
    if mode != "dev" {
        return Ok(());
    }
    let origin = header(request, "Origin");
    let browser = origin.is_some() || header(request, "Sec-Fetch-Site").is_some();
    if origin
        .as_deref()
        .is_some_and(|origin| !loopback_origin(origin))
    {
        return Err(Refusal::new(
            "E_AUTH_ORIGIN",
            "auth",
            "development requests require a loopback browser origin",
            "run the app on localhost and use a real account",
            "auth/personas",
        ));
    }
    // Browser JS cannot omit its Origin/Sec-Fetch-* headers or add a persona
    // through no-cors. Local CLI/journey requests retain first-use personas.
    if browser && header(request, "X-Snapback-As").is_some() {
        return Err(Refusal::new(
            "E_AUTH_PERSONA_NOT_DEV",
            "auth",
            "browser requests cannot select development personas",
            "use a real account in the browser; use --as in the local CLI",
            "auth/personas",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiny_http::TestRequest;
    #[test]
    fn cross_origin_and_browser_personas_are_refused_before_identity() {
        for origin in [
            "https://attacker.example",
            "null",
            "http://localhost.attacker.example:3000",
            "http://localhost:3000@attacker.example",
            "http://127.0.0.1:3000/path",
            "http://[::1]:3000\r\nInjected: yes",
        ] {
            assert!(!loopback_origin(origin));
        }
        for origin in [
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://[::1]:8081",
        ] {
            let request: Request = TestRequest::new()
                .with_header(header_value("Origin", origin))
                .into();
            assert_eq!(cors_origin(&request, "dev").as_deref(), Some(origin));
            assert!(browser_admission(&request, "dev").is_ok());
            let persona: Request = TestRequest::new()
                .with_header(header_value("Origin", origin))
                .with_header(header_value("X-Snapback-As", "new-persona"))
                .into();
            assert!(browser_admission(&persona, "dev").is_err());
        }
        let malicious: Request = TestRequest::new()
            .with_header(header_value("Origin", "https://attacker.example"))
            .into();
        assert!(browser_admission(&malicious, "dev").is_err());
        assert!(cors_origin(&malicious, "dev").is_none());
        let same_origin: Request = TestRequest::new()
            .with_header(header_value("Sec-Fetch-Site", "same-origin"))
            .with_header(header_value("X-Snapback-As", "new-persona"))
            .into();
        assert!(browser_admission(&same_origin, "dev").is_err());
        let cli: Request = TestRequest::new()
            .with_header(header_value("X-Snapback-As", "alice"))
            .into();
        assert!(browser_admission(&cli, "dev").is_ok());
    }
    #[test]
    fn control_secret_uses_constant_time_equality() {
        assert!(secret_matches(Some("secret"), "secret"));
        for value in [
            None,
            Some(""),
            Some("secreu"),
            Some("xecret"),
            Some("secret-longer"),
        ] {
            assert!(!secret_matches(value, "secret"));
        }
    }
}

#[derive(Default)]
pub(super) struct AuthLimiter(std::sync::Mutex<AuthAttempts>);
#[derive(Default)]
struct AuthAttempts {
    ips: std::collections::HashMap<Option<std::net::IpAddr>, (std::time::Instant, usize)>,
    accounts: std::collections::HashMap<String, (std::time::Instant, usize)>,
    global: Option<(std::time::Instant, usize)>,
    active: usize,
}
pub(super) struct AuthPermit<'a>(&'a AuthLimiter);
impl AuthLimiter {
    pub(super) fn admit(
        &self,
        ip: Option<std::net::IpAddr>,
        email: &str,
        now: std::time::Instant,
    ) -> Option<AuthPermit<'_>> {
        let mut state = self.0.lock().ok()?;
        let email = email.trim().to_lowercase();
        if email.len() > 320 || state.active >= 2 {
            return None;
        }
        let fresh = |entry: &(std::time::Instant, usize)| {
            now.saturating_duration_since(entry.0) < std::time::Duration::from_secs(60)
        };
        // Bounded tables; expire lazily only when capacity is reached.
        if state.accounts.len() >= 4096 {
            state.accounts.retain(|_, entry| fresh(entry));
        }
        if state.ips.len() >= 4096 {
            state.ips.retain(|_, entry| fresh(entry));
        }
        if (state.accounts.len() >= 4096 && !state.accounts.contains_key(&email))
            || (state.ips.len() >= 4096 && !state.ips.contains_key(&ip))
        {
            return None;
        }
        if state
            .global
            .as_ref()
            .is_some_and(|entry| fresh(entry) && entry.1 >= 32)
            || state
                .ips
                .get(&ip)
                .is_some_and(|entry| fresh(entry) && entry.1 >= 16)
            || state
                .accounts
                .get(&email)
                .is_some_and(|entry| fresh(entry) && entry.1 >= 8)
        {
            return None;
        }
        let add = |entry: &mut (std::time::Instant, usize)| {
            if !fresh(entry) {
                *entry = (now, 0);
            }
            entry.1 += 1;
        };
        add(state.global.get_or_insert((now, 0)));
        add(state.ips.entry(ip).or_insert((now, 0)));
        add(state.accounts.entry(email).or_insert((now, 0)));
        state.active += 1;
        Some(AuthPermit(self))
    }
}
impl Drop for AuthPermit<'_> {
    fn drop(&mut self) {
        let mut state = self.0.0.lock().unwrap_or_else(|error| error.into_inner());
        state.active = state.active.saturating_sub(1);
    }
}
#[cfg(test)]
mod auth_tests {
    use super::*;
    #[test]
    fn abuse_is_bounded_per_account_ip_and_inflight_and_recovers() {
        let limits = AuthLimiter::default();
        let now = std::time::Instant::now();
        let ip = Some("127.0.0.1".parse().unwrap());
        let a = limits.admit(ip, " A@example.com ", now).unwrap();
        let b = limits.admit(ip, "b@example.com", now).unwrap();
        assert!(limits.admit(ip, "c@example.com", now).is_none());
        drop((a, b));
        for _ in 1..8 {
            drop(limits.admit(ip, "a@example.com", now).unwrap());
        }
        assert!(
            limits
                .admit(Some("127.0.0.2".parse().unwrap()), "A@example.com", now)
                .is_none()
        );
        for n in 0..7 {
            drop(
                limits
                    .admit(ip, &format!("user{n}@example.com"), now)
                    .unwrap(),
            );
        }
        assert!(limits.admit(ip, "other@example.com", now).is_none());
        assert!(
            limits
                .admit(
                    ip,
                    "a@example.com",
                    now + std::time::Duration::from_secs(60)
                )
                .is_some()
        );
    }
}
