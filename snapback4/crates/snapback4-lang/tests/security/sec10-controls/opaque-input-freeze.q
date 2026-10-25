table docs:
  approved: bool default false
  consent: bool
  stage: enum('draft','done') default 'draft'
  immutable consent when .approved
  read <- allow
  update <- allow
  online only
mutation approve(doc: docs):
  d = docs[doc] ! else MISSING
  require d.consent else CONSENT
  update docs[doc] {approved:true}
fn opaque(flag: bool):
  if flag:
    return false
  return false
mutation edit(doc: docs,flag: bool):
  update docs[doc] {consent:false} if opaque(flag)
mutation finish(doc: docs):
  update docs[doc] {stage:'done'}
