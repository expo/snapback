use identity guests

table oidcTransactions:
  beginInvocation: text <=128
  admittingPrincipal: principal
  configFingerprint: text <=64
  bindingHash: text <=64
  state: text <=256
  nonce: text <=256
  pkceVerifier: text <=128
  createdAt: time
  expiresAt: time
  completionInvocation: text <=128 ?
  verifiedIssuer: text <=2048 format url ?
  verifiedSubject: text <=1024 ?
  email: text <=320 ?
  emailVerified: bool ?
  unique byBeginInvocation: beginInvocation
  unique byState: state
  by byExpiry: expiresAt
  expire at .expiresAt
  read <- viewer = 'service:worker'
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- viewer = 'service:worker'

query identityByInvocation(invocation: text <=128):
  return oidcTransactions[beginInvocation = invocation]

query identityByState(state: text <=256):
  return oidcTransactions[state = state]

mutation identityBegin(id: id, beginInvocation: text <=128, admittingPrincipal: principal, configFingerprint: text <=64, bindingHash: text <=64, state: text <=256, nonce: text <=256, pkceVerifier: text <=128, createdAt: time, expiresAt: time, completionInvocation: text <=128 ?, verifiedIssuer: text <=2048 format url ?, verifiedSubject: text <=1024 ?, email: text <=320 ?, emailVerified: bool ?):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  insert oidcTransactions { id, beginInvocation, admittingPrincipal, configFingerprint, bindingHash, state, nonce, pkceVerifier, createdAt, expiresAt, completionInvocation, verifiedIssuer, verifiedSubject, email, emailVerified }
  return null

mutation identityClaim(id: oidcTransactions, completionInvocation: text <=128):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  tx = oidcTransactions[id] ! else OIDC_TRANSACTION_EXPIRED
  if tx.completionInvocation != null:
    require tx.completionInvocation = completionInvocation else OIDC_TRANSACTION_CLAIMED
  else:
    update oidcTransactions[tx.id] { completionInvocation }
  return null

mutation identityVerified(id: oidcTransactions, completionInvocation: text <=128, issuer: text <=2048 format url, subject: text <=1024, email: text <=320 ?, emailVerified: bool ?):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  tx = oidcTransactions[id] ! else OIDC_TRANSACTION_EXPIRED
  require tx.completionInvocation = completionInvocation else OIDC_TRANSACTION_CLAIMED
  update oidcTransactions[tx.id] { verifiedIssuer: issuer, verifiedSubject: subject, email, emailVerified }
  return null

action beginOidc(bindingHash: text <=64) returns { authorizationUrl: text <=4096 format url } secrets [OIDC_CLIENT_SECRET] retry 3 deadline 10m
action completeOidc(code: text <=4096 ?, state: text <=256, binding: text <=1024, error: text <=200 ?, iss: text <=2048 format url ?) returns { principal: principal, kind: text <=64, token: text <=2048, expiresAt: time } secrets [OIDC_CLIENT_SECRET] retry 3 deadline 10m
