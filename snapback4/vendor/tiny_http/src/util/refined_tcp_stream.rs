use std::io::Result as IoResult;
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr};
use std::sync::Arc;

use crate::connection::Connection;
#[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
use crate::ssl::SslStream;

pub(crate) enum Stream {
    Http(Connection),
    #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
    Https(SslStream),
}

#[derive(Clone)]
pub(crate) struct ConnectionAbort(Stream);

impl ConnectionAbort {
    pub(crate) fn abort(&mut self) {
        self.0.shutdown(Shutdown::Both).ok();
    }
}

impl Clone for Stream {
    fn clone(&self) -> Self {
        match self {
            Stream::Http(tcp_stream) => Stream::Http(tcp_stream.try_clone().unwrap()),
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(ssl_stream) => Stream::Https(ssl_stream.clone()),
        }
    }
}

impl From<Connection> for Stream {
    fn from(tcp_stream: Connection) -> Self {
        Stream::Http(tcp_stream)
    }
}

impl Stream {
    fn secure(&self) -> bool {
        match self {
            Stream::Http(_) => false,
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(_) => true,
        }
    }

    fn peer_addr(&mut self) -> IoResult<Option<SocketAddr>> {
        match self {
            Stream::Http(tcp_stream) => tcp_stream.peer_addr(),
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(ssl_stream) => ssl_stream.peer_addr(),
        }
    }

    fn shutdown(&mut self, how: Shutdown) -> IoResult<()> {
        match self {
            Stream::Http(tcp_stream) => tcp_stream.shutdown(how),
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(ssl_stream) => ssl_stream.shutdown(how),
        }
    }
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        match self {
            Stream::Http(tcp_stream) => tcp_stream.read(buf),
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(ssl_stream) => ssl_stream.read(buf),
        }
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> IoResult<usize> {
        match self {
            Stream::Http(tcp_stream) => tcp_stream.write(buf),
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(ssl_stream) => ssl_stream.write(buf),
        }
    }

    fn flush(&mut self) -> IoResult<()> {
        match self {
            Stream::Http(tcp_stream) => tcp_stream.flush(),
            #[cfg(any(feature = "ssl-openssl", feature = "ssl-rustls"))]
            Stream::Https(ssl_stream) => ssl_stream.flush(),
        }
    }
}

pub struct RefinedTcpStream {
    stream: Stream,
    close_read: bool,
    close_write: bool,
    limits: Option<Arc<crate::limits::ConnectionState>>,
}

impl RefinedTcpStream {
    pub(crate) fn new<S>(stream: S) -> (RefinedTcpStream, RefinedTcpStream)
    where
        S: Into<Stream>,
    {
        let stream: Stream = stream.into();

        let (read, write) = (stream.clone(), stream);

        let read = RefinedTcpStream {
            stream: read,
            close_read: true,
            close_write: false,
            limits: None,
        };

        let write = RefinedTcpStream {
            stream: write,
            close_read: false,
            close_write: true,
            limits: None,
        };

        (read, write)
    }

    pub(crate) fn with_limits(mut self, limits: Option<Arc<crate::limits::ConnectionState>>) -> Self {
        self.limits = limits;
        self
    }

    /// Returns true if this struct wraps around a secure connection.
    #[inline]
    pub(crate) fn secure(&self) -> bool {
        self.stream.secure()
    }

    pub(crate) fn peer_addr(&mut self) -> IoResult<Option<SocketAddr>> {
        self.stream.peer_addr()
    }

    pub(crate) fn abort_handle(&self) -> ConnectionAbort {
        ConnectionAbort(self.stream.clone())
    }
}

impl Drop for RefinedTcpStream {
    fn drop(&mut self) {
        if self.close_read {
            self.stream.shutdown(Shutdown::Read).ok();
        }

        if self.close_write {
            self.stream.shutdown(Shutdown::Write).ok();
        }
    }
}

impl Read for RefinedTcpStream {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        if let Some(limits) = &self.limits { limits.before_read()?; }
        let result = self.stream.read(buf);
        if result.as_ref().err().is_some_and(|e| e.kind() != std::io::ErrorKind::Interrupted) {
            if let Some(limits) = &self.limits { limits.shutdown(); }
        }
        result
    }
}

impl Write for RefinedTcpStream {
    fn write(&mut self, buf: &[u8]) -> IoResult<usize> {
        if let Some(limits) = &self.limits { limits.before_write()?; }
        let result = self.stream.write(buf);
        if result.as_ref().err().is_some_and(|e| e.kind() != std::io::ErrorKind::Interrupted) {
            if let Some(limits) = &self.limits { limits.shutdown(); }
        }
        result
    }

    fn flush(&mut self) -> IoResult<()> {
        if let Some(limits) = &self.limits { limits.before_write()?; }
        self.stream.flush()
    }
}
