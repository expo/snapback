table docs:
  consent: bool
  approved: bool default false
  status: enum('draft','done') default 'draft'
  read <- allow
  insert <- allow
  update <- allow
  online only
mutation create():
  return insert docs {consent:true}
mutation approve(doc: docs):
  d = docs[doc] ! else MISSING
  require true or d.consent else CONSENT
  update docs[doc] {approved:true}
mutation edit(doc: docs,consent: bool):
  update docs[doc] {consent}
mutation finish(doc: docs):
  d = docs[doc] ! else MISSING
  require d.approved else APPROVAL
  update docs[doc] {status:'done'}
