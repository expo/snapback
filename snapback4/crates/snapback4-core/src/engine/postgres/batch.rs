//! Composed access, one statement for every live member at a dependency level.
use super::store::{Tx, decode};
use crate::{RuntimeError, engine::committer::overlay::{Access, Base}, store_port::batch::{Facts,Request}};
use serde_json::json;

const LEVEL: &str = r#"WITH q AS (
 SELECT * FROM jsonb_to_recordset($1::text::jsonb) AS q(n bigint,t text,ix text,id text,lo text,hi text)
)
SELECT q.n, a.data FROM q LEFT JOIN LATERAL (
 SELECT r.data FROM r WHERE q.ix='byId' AND r.t=q.t AND r.id=q.id
 UNION ALL
 (SELECT r.data FROM i JOIN r ON r.t=i.t AND r.id=i.id
 WHERE q.ix<>'byId' AND i.t=q.t AND i.ix=q.ix AND i.k>=decode(q.lo,'hex') AND i.k<decode(q.hi,'hex') ORDER BY i.k LIMIT 1)
) a ON true ORDER BY q.n"#;
macro_rules! authority_sql { ($sessions:literal) => { concat!(r#"WITH q AS (
 SELECT n::bigint-1 AS n, x->>'digest' AS digest FROM jsonb_array_elements($1::text::jsonb) WITH ORDINALITY a(x,n)
), sessions AS ("#, $sessions, r#")
SELECT s.principal,COALESCE(s.family,s.token_digest),s.kind,s.token_digest,s.expires_at,s.scope,
 s.cap_expires_at,s.principal_generation,COALESCE(g.generation,0),
 (SELECT value FROM _meta WHERE key='worker:session-family'),
 (SELECT value FROM _meta WHERE key='worker:session-revision'),
 (SELECT value FROM _meta WHERE key='worker:family:' || COALESCE(s.family,s.token_digest)),
 (SELECT value FROM _meta WHERE key='generation'),(SELECT value FROM _meta WHERE key='store_id'),
 (SELECT generation FROM _backend WHERE singleton),NULL::text,NULL::text,NULL::text,
 (SELECT seq FROM _head WHERE singleton),q.n
FROM q LEFT JOIN sessions s ON s.token_digest=q.digest
LEFT JOIN _principal_generations g ON g.principal=s.principal ORDER BY q.n"#) }; }
const AUTH: &str=authority_sql!("SELECT principal,family,kind,token_digest,expires_at,0 AS scope,NULL::bigint AS cap_expires_at,NULL::bigint AS principal_generation FROM _sessions");
const AUTH_READ: &str=authority_sql!("SELECT principal,family,kind,token_digest,expires_at,0 AS scope,NULL::bigint AS cap_expires_at,NULL::bigint AS principal_generation FROM _sessions UNION ALL SELECT principal,family,kind,token_digest,expires_at,1,cap_expires_at,principal_generation FROM _read_sessions");
const RECEIPTS: &str=r#"WITH q AS (
 SELECT n::bigint-1 AS n,x->>'principal' AS principal,x->>'id' AS id FROM jsonb_array_elements($1::text::jsonb) WITH ORDINALITY a(x,n)
) SELECT q.n,r.outcome,r.name,r.args_digest,a.placement,a.facts,a.state
FROM q LEFT JOIN _ops r ON r.principal=q.principal AND r.id=q.id
LEFT JOIN _asset_intents a ON a.owner=q.principal AND a.intent=q.id ORDER BY q.n"#;
impl Tx<'_> {
    pub(crate) fn install_batch_facts(&self, facts: &Facts) {
        *self.authority_cache.borrow_mut()=facts.authority.clone();
        *self.receipt_cache.borrow_mut()=facts.receipt.clone();
        *self.placement_cache.borrow_mut()=facts.placement.clone();
    }
    pub(crate) fn overlay_evidence(&self, changes: &crate::revocation::Recorder) { *self.changes.borrow_mut()=changes.clone(); }

    pub(crate) fn batch_level(&self, accesses: &[Access], base: &mut Base) -> Result<(),RuntimeError> {
        if accesses.is_empty(){return Ok(());}
        let payload=accesses.iter().enumerate().map(|(n,a)| {
            let (lo,hi)=crate::rows::scan_range(&a.key,&Default::default(),crate::rows::Dir::Asc).unwrap();
            let hex=|bytes:Vec<u8>|bytes.iter().map(|b|format!("{b:02x}")).collect::<String>();
            json!({"n":n,"t":a.table,"ix":a.index,"id":if a.index=="byId" {a.key[0].as_str().unwrap_or("")} else {""},"lo":hex(lo),"hi":hex(hi)})
        }).collect::<Vec<_>>();
        let payload=serde_json::to_string(&payload).unwrap();
        let rows=self.query(LEVEL,&[&payload])?;
        if rows.len()!=accesses.len(){return Err(RuntimeError::Store("batch level count mismatch".into()));}
        for (n,row) in rows.into_iter().enumerate() {
            if row.get::<_,i64>(0)!=n as i64{return Err(RuntimeError::Store("batch level ordinal mismatch".into()));}
            base.insert(&accesses[n],row.get::<_,Option<String>>(1).map(|v|decode(&v)).transpose()?);
        }
        Ok(())
    }
    pub(crate) fn batch_facts(&self, requests:&[Request])->Result<Vec<Facts>,RuntimeError>{
        let payload=serde_json::to_string(requests).unwrap();
        let auth=if self.read_sessions.get()||self.read_sessions_installed.get(){AUTH_READ}else{AUTH};
        let sets=self.flight(&[(auth,&[&payload]),(RECEIPTS,&[&payload])],"")?;
        let mut grouped:Vec<Vec<super::store::Row>>=requests.iter().map(|_|Vec::new()).collect();
        for row in &sets[0].rows {
            let n=row.get::<_,i64>(19) as usize;
            if n>=requests.len(){return Err(RuntimeError::Store("batch authority ordinal mismatch".into()));}
        }
        let mut sets=sets.into_iter();
        for row in sets.next().unwrap().rows {grouped[row.get::<_,i64>(19) as usize].push(row);}
        let mut facts=Vec::new();
        for (n,rows) in grouped.into_iter().enumerate(){
            if rows.is_empty(){return Err(RuntimeError::Store("missing batch authority".into()));}
            let mut f=Facts::default();
            if let Some(digest)=&requests[n].digest {
                let mut authority=super::authority::session_facts_rows(rows);
                // Unknown storage/kinds use the ordinary complete resolver in place.
                if authority.sessions.is_empty() && !self.read_sessions.get(){authority=self.session_authority_facts(digest)?;}
                f.authority=Some((digest.clone(),authority));
            }
            facts.push(f);
        }
        let rows=sets.next().unwrap().rows;
        if rows.len()!=requests.len(){return Err(RuntimeError::Store("batch receipt count mismatch".into()));}
        for (n,row) in rows.into_iter().enumerate(){
            if row.get::<_,i64>(0)!=n as i64{return Err(RuntimeError::Store("batch receipt ordinal mismatch".into()));}
            if let Some(id)=&requests[n].id {
                let key=(requests[n].principal.clone(),id.clone());
                facts[n].receipt=Some((key.clone(),row.get::<_,Option<String>>(1).map(|outcome|crate::receipts::ReceiptRecord{outcome,name:row.get(2),args_digest:row.get(3)})));
                facts[n].placement=Some((key,row.get::<_,Option<String>>(6).map(|state|crate::assets::IntentRecord{state,binding:row.get(4),facts:row.get(5)})));
            }
        }
        Ok(facts)
    }
}
