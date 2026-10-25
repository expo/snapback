//! One synchronous client on its own thread. The committer exchanges owned data.
// @ref LLP 3000.009.001.000.000.002#3.10 — writer sockets never run on PIPE or on the engine owner.
use postgres::{
    Client, Row, SimpleQueryMessage, Statement,
    types::{Format, IsNull, ToSql, Type},
};
use std::{sync::mpsc, thread};
type Work = Box<dyn FnOnce(&mut Client) + Send>;
pub(crate) struct Driver {
    sender: Option<mpsc::Sender<Work>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Driver {
    pub fn empty() -> Self {
        Self {
            sender: None,
            worker: None,
        }
    }
    pub fn new(mut client: Client) -> Self {
        let (sender, receiver) = mpsc::channel::<Work>();
        let worker = thread::Builder::new()
            .name("sb4-pg-writer".into())
            .spawn(move || {
                while let Ok(work) = receiver.recv() {
                    work(&mut client);
                }
            })
            .expect("writer thread");
        Self {
            sender: Some(sender),
            worker: Some(worker),
        }
    }
    pub fn call<T: Send + 'static>(
        &self,
        run: impl FnOnce(&mut Client) -> T + Send + 'static,
    ) -> T {
        let (send, receive) = mpsc::sync_channel(1);
        self.sender
            .as_ref()
            .unwrap()
            .send(Box::new(move |client| {
                let _ = send.send(run(client));
            }))
            .unwrap_or_else(|_| panic!("writer driver stopped"));
        receive.recv().expect("writer driver result")
    }
    pub fn is_closed(&self) -> bool {
        self.sender.is_none() || self.call(|c| c.is_closed())
    }
    pub fn prepare(&self, sql: &str) -> Result<Statement, postgres::Error> {
        let sql = sql.to_owned();
        self.call(move |c| c.prepare(&sql))
    }
    fn statement<T: Source + ?Sized>(&self, source: &T) -> Result<Statement, postgres::Error> {
        match source.owned() {
            Query::Statement(s) => Ok(s),
            Query::Sql(s) => self.prepare(&s),
        }
    }
    pub fn query<T: Source + ?Sized>(
        &self,
        source: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Vec<Row>, postgres::Error> {
        let statement = self.statement(source)?;
        let params = encode(&statement, params);
        self.call(move |c| c.query(&statement, &refs(&params)))
    }
    pub fn query_one<T: Source + ?Sized>(
        &self,
        source: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Row, postgres::Error> {
        let statement = self.statement(source)?;
        let params = encode(&statement, params);
        self.call(move |c| c.query_one(&statement, &refs(&params)))
    }
    pub fn query_opt<T: Source + ?Sized>(
        &self,
        source: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Option<Row>, postgres::Error> {
        let statement = self.statement(source)?;
        let params = encode(&statement, params);
        self.call(move |c| c.query_opt(&statement, &refs(&params)))
    }
    pub fn execute<T: Source + ?Sized>(
        &self,
        source: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<u64, postgres::Error> {
        let statement = self.statement(source)?;
        let params = encode(&statement, params);
        self.call(move |c| c.execute(&statement, &refs(&params)))
    }
    pub fn stream(
        &self,
        statement: &Statement,
        params: &[&(dyn ToSql + Sync)],
    ) -> mpsc::Receiver<Result<Option<Row>, postgres::Error>> {
        let statement = statement.clone();
        let params = encode(&statement, params);
        let (send, receive) = mpsc::sync_channel(1);
        self.sender
            .as_ref()
            .unwrap()
            .send(Box::new(move |client| {
                use postgres::fallible_iterator::FallibleIterator;
                let result = (|| {
                    let mut rows = client.query_raw(&statement, refs(&params))?;
                    while let Some(row) = rows.next()? {
                        if send.send(Ok(Some(row))).is_err() {
                            return Ok(());
                        }
                    }
                    Ok::<_, postgres::Error>(())
                })();
                let _ = send.send(result.map(|()| None));
            }))
            .unwrap_or_else(|_| panic!("writer driver stopped"));
        receive
    }
    pub fn simple_query(&self, sql: &str) -> Result<Vec<SimpleQueryMessage>, postgres::Error> {
        let sql = sql.to_owned();
        self.call(move |c| c.simple_query(&sql))
    }
    pub fn batch_execute(&self, sql: &str) -> Result<(), postgres::Error> {
        let sql = sql.to_owned();
        self.call(move |c| c.batch_execute(&sql))
    }
}
impl Drop for Driver {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
pub(crate) enum Query {
    Sql(String),
    Statement(Statement),
}
pub(crate) trait Source {
    fn owned(&self) -> Query;
}
impl Source for str {
    fn owned(&self) -> Query {
        Query::Sql(self.into())
    }
}
impl Source for String {
    fn owned(&self) -> Query {
        Query::Sql(self.clone())
    }
}
impl Source for Statement {
    fn owned(&self) -> Query {
        Query::Statement(self.clone())
    }
}
#[derive(Debug)]
struct Encoded {
    data: Result<Option<Vec<u8>>, String>,
    format: Format,
}
impl ToSql for Encoded {
    fn to_sql(
        &self,
        _: &Type,
        out: &mut postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        match &self.data {
            Ok(Some(data)) => {
                out.extend_from_slice(data);
                Ok(IsNull::No)
            }
            Ok(None) => Ok(IsNull::Yes),
            Err(error) => Err(std::io::Error::other(error.clone()).into()),
        }
    }
    fn accepts(_: &Type) -> bool {
        true
    }
    postgres::types::to_sql_checked!();
    fn encode_format(&self, _: &Type) -> Format {
        self.format
    }
}
fn encode(statement: &Statement, params: &[&(dyn ToSql + Sync)]) -> Vec<Encoded> {
    assert_eq!(
        statement.params().len(),
        params.len(),
        "driver parameter arity"
    );
    params
        .iter()
        .zip(statement.params())
        .map(|(param, ty)| {
            let mut bytes = postgres::types::private::BytesMut::new();
            let data = param
                .to_sql_checked(ty, &mut bytes)
                .map(|null| {
                    if matches!(null, IsNull::Yes) {
                        None
                    } else {
                        Some(bytes.to_vec())
                    }
                })
                .map_err(|e| e.to_string());
            Encoded {
                data,
                format: param.encode_format(ty),
            }
        })
        .collect()
}
fn refs(params: &[Encoded]) -> Vec<&(dyn ToSql + Sync)> {
    params.iter().map(|p| p as &(dyn ToSql + Sync)).collect()
}
