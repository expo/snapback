use ascii::AsciiString;

use std::io::Error as IoError;
use std::io::Result as IoResult;
use std::io::{BufReader, BufWriter, ErrorKind, Read};

use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::Arc;

use crate::common::{HTTPVersion, Method};
use crate::util::{ConnectionAbort, RefinedTcpStream, SequentialWriterAbort};
use crate::util::{SequentialReader, SequentialReaderBuilder, SequentialWriterBuilder};
use crate::Request;

const REQUEST_LINE_CEILING: usize = 8 * 1024;
const HEADER_LINE_CEILING: usize = 8 * 1024;
const HEADER_BYTES_CEILING: usize = 64 * 1024;
const HEADER_COUNT_CEILING: usize = 100;

/// A ClientConnection is an object that will store a socket to a client
/// and return Request objects.
pub struct ClientConnection {
    // address of the client
    remote_addr: IoResult<Option<SocketAddr>>,

    // sequence of Readers to the stream, so that the data is not read in
    //  the wrong order
    source: SequentialReaderBuilder<BufReader<RefinedTcpStream>>,

    // sequence of Writers to the stream, to avoid writing response #2 before
    //  response #1
    sink: SequentialWriterBuilder<BufWriter<RefinedTcpStream>>,

    // A failed checked response has already put an incomplete HTTP message on
    // the wire. Shut down the whole connection before the next sequential
    // writer is released, so a pipelined response cannot become body bytes.
    abort: ConnectionAbort,

    // Marks every queued response writer unusable before the failed writer
    // releases the next request in the pipeline.
    abort_writers: SequentialWriterAbort,

    // Reader to read the next header from
    next_header_source: SequentialReader<BufReader<RefinedTcpStream>>,

    // set to true if we know that the previous request is the last one
    no_more_requests: bool,

    // true if the connection goes through SSL
    secure: bool,
    limits: Option<Arc<crate::limits::ConnectionState>>,
    header_bytes: usize,
}

/// Error that can happen when reading a request.
#[derive(Debug)]
enum ReadError {
    WrongRequestLine,
    UnsupportedVersion,
    WrongHeader(HTTPVersion),
    HeadersTooLarge(HTTPVersion),
    /// the client sent an unrecognized `Expect` header
    ExpectationFailed(HTTPVersion),
    ReadIoError(IoError),
}

impl ClientConnection {
    /// Creates a new `ClientConnection` that takes ownership of the `TcpStream`.
    pub fn new(
        write_socket: RefinedTcpStream,
        mut read_socket: RefinedTcpStream,
        limits: Option<Arc<crate::limits::ConnectionState>>,
    ) -> IoResult<ClientConnection> {
        let remote_addr = read_socket.peer_addr();
        let secure = read_socket.secure();
        let abort = write_socket.abort_handle()?;

        let mut source = SequentialReaderBuilder::new(BufReader::with_capacity(1024, read_socket));
        let first_header = source.next().unwrap();

        let sink = SequentialWriterBuilder::new(BufWriter::with_capacity(1024, write_socket));
        let abort_writers = sink.abort_handle();

        Ok(ClientConnection {
            source,
            sink,
            abort,
            abort_writers,
            remote_addr,
            next_header_source: first_header,
            no_more_requests: false,
            secure,
            limits,
            header_bytes: 0,
        })
    }

    /// true if the connection is HTTPS
    pub fn secure(&self) -> bool {
        self.secure
    }

    /// Reads the next line from self.next_header_source.
    ///
    /// Reads until `CRLF` is reached. The next read will start
    ///  at the first byte of the new line.
    fn read_next_line(&mut self, ceiling: usize) -> IoResult<AsciiString> {
        let mut buf = Vec::new();
        let mut prev_byte_was_cr = false;

        loop {
            if let Some(limits) = &self.limits {
                self.header_bytes += 1;
                if self.header_bytes > limits.limits.max_header_bytes {
                    return Err(IoError::new(ErrorKind::InvalidData, "HTTP headers exceed the host limit"));
                }
            }
            let byte = self.next_header_source.by_ref().bytes().next();

            let byte = match byte {
                Some(b) => b?,
                None => return Err(IoError::new(ErrorKind::ConnectionAborted, "Unexpected EOF")),
            };

            if byte == b'\n' && prev_byte_was_cr {
                buf.pop(); // removing the '\r'
                return AsciiString::from_ascii(buf)
                    .map_err(|_| IoError::new(ErrorKind::InvalidInput, "Header is not in ASCII"));
            }

            prev_byte_was_cr = byte == b'\r';

            if buf.len() >= ceiling {
                return Err(IoError::new(ErrorKind::InvalidData, "HTTP line exceeds its byte limit"));
            }
            buf.push(byte);
        }
    }

    /// Reads a request from the stream.
    /// Blocks until the header has been read.
    fn read(&mut self) -> Result<Request, ReadError> {
        self.header_bytes = 0;
        if let Some(limits) = &self.limits { limits.headers(); }
        let (method, path, version, headers) = {
            // reading the request line
            let (method, path, version) = {
                let line = self.read_next_line(REQUEST_LINE_CEILING).map_err(|error| {
                    if error.kind() == ErrorKind::InvalidData {
                        ReadError::WrongRequestLine
                    } else {
                        ReadError::ReadIoError(error)
                    }
                })?;

                parse_request_line(
                    line.as_str().trim(), // TODO: remove this conversion
                )?
            };

            // getting all headers
            let headers = {
                let mut headers = Vec::new();
                let mut header_bytes = 0_usize;
                loop {
                    let line = self.read_next_line(HEADER_LINE_CEILING).map_err(|error| {
                        if error.kind() == ErrorKind::InvalidData {
                            ReadError::HeadersTooLarge(version.clone())
                        } else {
                            ReadError::ReadIoError(error)
                        }
                    })?;

                    if line.is_empty() {
                        break;
                    };
                    header_bytes = header_bytes.saturating_add(line.len() + 2);
                    if header_bytes > HEADER_BYTES_CEILING || headers.len() >= HEADER_COUNT_CEILING {
                        return Err(ReadError::HeadersTooLarge(version));
                    }
                    headers.push(match FromStr::from_str(line.as_str().trim()) {
                        // TODO: remove this conversion
                        Ok(h) => h,
                        _ => return Err(ReadError::WrongHeader(version)),
                    });
                }

                headers
            };

            (method, path, version, headers)
        };

        // building the writer for the request
        // Refuse before allocating this request's sequential writer. Taking
        // a second writer while the Request owns the first deadlocks before
        // reaching the socket deadline, permanently retaining the lease.
        if version > (1, 1) { return Err(ReadError::UnsupportedVersion); }
        if let Some(limits) = &self.limits { limits.body(); }
        let writer = self.sink.next().unwrap();

        // follow-up for next potential request
        let mut data_source = self.source.next().unwrap();
        std::mem::swap(&mut self.next_header_source, &mut data_source);

        // building the next reader
        let request = crate::request::new_request_with_abort(
            self.secure,
            method,
            path,
            version.clone(),
            headers,
            *self.remote_addr.as_ref().unwrap(),
            data_source,
            writer,
            self.abort.clone(),
            self.abort_writers.clone(),
        )
        .map_err(|e| {
            use crate::request;
            match e {
                request::RequestCreationError::CreationIoError(e) => ReadError::ReadIoError(e),
                request::RequestCreationError::ExpectationFailed => {
                    ReadError::ExpectationFailed(version)
                }
            }
        })?;

        // return the request
        Ok(request.with_limits(self.limits.clone()))
    }
}

impl Iterator for ClientConnection {
    type Item = Request;

    /// Blocks until the next Request is available.
    /// Returns None when no new Requests will come from the client.
    fn next(&mut self) -> Option<Request> {
        use crate::{Response, StatusCode};

        // the client sent a "connection: close" header in this previous request
        //  or is using HTTP 1.0, meaning that no new request will come
        if self.no_more_requests {
            return None;
        }

        loop {
            let rq = match self.read() {
                Err(ReadError::WrongRequestLine) => {
                    let writer = self.sink.next().unwrap();
                    let response = Response::new_empty(StatusCode(400));
                    response
                        .raw_print(writer, HTTPVersion(1, 1), &[], false, None)
                        .ok();
                    return None; // we don't know where the next request would start,
                                 // se we have to close
                }

                Err(ReadError::UnsupportedVersion) => {
                    let writer = self.sink.next().unwrap();
                    Response::from_string("This server only supports HTTP versions 1.0 and 1.1")
                        .with_status_code(StatusCode(505))
                        .raw_print(writer, HTTPVersion(1, 1), &[], false, None).ok();
                    return None;
                }

                Err(ReadError::WrongHeader(ver)) => {
                    let writer = self.sink.next().unwrap();
                    let response = Response::new_empty(StatusCode(400));
                    response.raw_print(writer, ver, &[], false, None).ok();
                    return None; // we don't know where the next request would start,
                                 // se we have to close
                }

                Err(ReadError::HeadersTooLarge(ver)) => {
                    let writer = self.sink.next().unwrap();
                    let response = Response::new_empty(StatusCode(431));
                    response.raw_print(writer, ver, &[], false, None).ok();
                    return None;
                }

                Err(ReadError::ReadIoError(ref err)) if err.kind() == ErrorKind::TimedOut => {
                    // request timeout
                    let writer = self.sink.next().unwrap();
                    let response = Response::new_empty(StatusCode(408));
                    response
                        .raw_print(writer, HTTPVersion(1, 1), &[], false, None)
                        .ok();
                    return None; // closing the connection
                }

                Err(ReadError::ExpectationFailed(ver)) => {
                    let writer = self.sink.next().unwrap();
                    let response = Response::new_empty(StatusCode(417));
                    response.raw_print(writer, ver, &[], true, None).ok();
                    return None; // TODO: should be recoverable, but needs handling in case of body
                }

                Err(ReadError::ReadIoError(_)) => return None,

                Ok(rq) => rq,
            };

            // updating the status of the connection
            self.no_more_requests = rq.connection_closes();

            // returning the request
            return Some(rq);
        }
    }
}

/// Parses a "HTTP/1.1" string.
fn parse_http_version(version: &str) -> Result<HTTPVersion, ReadError> {
    let (major, minor) = match version {
        "HTTP/0.9" => (0, 9),
        "HTTP/1.0" => (1, 0),
        "HTTP/1.1" => (1, 1),
        "HTTP/2.0" => (2, 0),
        "HTTP/3.0" => (3, 0),
        _ => return Err(ReadError::WrongRequestLine),
    };

    Ok(HTTPVersion(major, minor))
}

/// Parses the request line of the request.
/// eg. GET / HTTP/1.1
fn parse_request_line(line: &str) -> Result<(Method, String, HTTPVersion), ReadError> {
    let mut parts = line.split(' ');

    let method = parts.next().and_then(|w| w.parse().ok());
    let path = parts.next().map(ToOwned::to_owned);
    let version = parts.next().and_then(|w| parse_http_version(w).ok());

    method
        .and_then(|method| Some((method, path?, version?)))
        .ok_or(ReadError::WrongRequestLine)
}

#[cfg(test)]
mod test {
    #[test]
    fn test_parse_request_line() {
        let (method, path, ver) = super::parse_request_line("GET /hello HTTP/1.1").unwrap();

        assert!(method == crate::Method::Get);
        assert!(path == "/hello");
        assert!(ver == crate::common::HTTPVersion(1, 1));

        assert!(super::parse_request_line("GET /hello").is_err());
        assert!(super::parse_request_line("qsd qsd qsd").is_err());
    }
}
