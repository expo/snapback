//! Owned HTTP admission inputs, without a socket or body reader.
use super::*;

pub(crate) trait RequestInfo {
    fn method(&self) -> &Method;
    fn url(&self) -> &str;
    fn headers(&self) -> &[Header];
    fn remote_addr(&self) -> Option<&std::net::SocketAddr>;
}
impl RequestInfo for Request {
    fn method(&self) -> &Method {
        self.method()
    }
    fn url(&self) -> &str {
        self.url()
    }
    fn headers(&self) -> &[Header] {
        self.headers()
    }
    fn remote_addr(&self) -> Option<&std::net::SocketAddr> {
        self.remote_addr()
    }
}
#[derive(Clone)]
pub(crate) struct RequestFacts {
    method: Method,
    url: String,
    headers: Vec<Header>,
    remote: Option<std::net::SocketAddr>,
}
impl RequestFacts {
    pub(crate) fn capture(request: &Request) -> Self {
        Self {
            method: request.method().clone(),
            url: request.url().to_owned(),
            headers: request.headers().to_vec(),
            remote: request.remote_addr().copied(),
        }
    }
}
impl RequestInfo for RequestFacts {
    fn method(&self) -> &Method {
        &self.method
    }
    fn url(&self) -> &str {
        &self.url
    }
    fn headers(&self) -> &[Header] {
        &self.headers
    }
    fn remote_addr(&self) -> Option<&std::net::SocketAddr> {
        self.remote.as_ref()
    }
}
