use server
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
  loginOrder: int
  proofStartedAt: time
  completionInvocation: text <=128 ?
  verifiedPrincipal: principal ?
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

table identityCounters:
  name: text <=64
  value: int
  unique byName: name
  read <- viewer = 'service:worker'
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- deny

table oidcTrustedProfiles:
  principal: principal
  issuer: text <=2048 format url
  subject: text <=1024
  email: text <=320 ?
  emailVerified: bool ?
  evidenceSource: enum('login')
  sourceLogin: oidcTransactions
  proofStartedAt: time
  proofExpiresAt: time
  loginOrder: int
  unique byPrincipal: principal
  read <- .principal = viewer or viewer = 'service:worker'
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- viewer = 'service:worker'

query identityByInvocation(invocation: text <=128):
  return oidcTransactions[beginInvocation = invocation]

query identityByState(state: text <=256):
  return oidcTransactions[state = state]

query identityWhoami():
  return viewer

query identityOwnProfile():
  return oidcTrustedProfiles[principal = viewer]

query identityOwnProfileEligibility():
  profile = oidcTrustedProfiles[principal = viewer]
  eligible = profile != null and profile.email != null and profile.emailVerified = true and profile.proofExpiresAt > now
  return { profile, eligible }

query identityProfileFor(principal: principal):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  return oidcTrustedProfiles[principal = principal]

mutation identityBegin(id: id, beginInvocation: text <=128, admittingPrincipal: principal, configFingerprint: text <=64, bindingHash: text <=64, state: text <=256, nonce: text <=256, pkceVerifier: text <=128, createdAt: time, expiresAt: time, completionInvocation: text <=128 ?, verifiedIssuer: text <=2048 format url ?, verifiedSubject: text <=1024 ?, email: text <=320 ?, emailVerified: bool ?):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  counter = identityCounters[name = 'oidc-login']
  loginOrder = counter.value + 1 if counter != null else 1
  upsert identityCounters[name = 'oidc-login'] { value: loginOrder }
  insert oidcTransactions { id, beginInvocation, admittingPrincipal, configFingerprint, bindingHash, state, nonce, pkceVerifier, createdAt, expiresAt, loginOrder, proofStartedAt: now, completionInvocation, verifiedPrincipal: null, verifiedIssuer, verifiedSubject, email, emailVerified }
  return null

mutation identityClaim(id: oidcTransactions, completionInvocation: text <=128):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  tx = oidcTransactions[id = id] ! else OIDC_TRANSACTION_EXPIRED
  if tx.completionInvocation != null:
    require tx.completionInvocation = completionInvocation else OIDC_TRANSACTION_CLAIMED
  else:
    update oidcTransactions[id = tx.id] { completionInvocation }
  return null

mutation identityVerified(id: oidcTransactions, completionInvocation: text <=128, principal: principal, issuer: text <=2048 format url, subject: text <=1024, email: text <=320 ?, emailVerified: bool ?):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  tx = oidcTransactions[id = id] ! else OIDC_TRANSACTION_EXPIRED
  require tx.completionInvocation = completionInvocation else OIDC_TRANSACTION_CLAIMED
  if tx.verifiedPrincipal != null:
    require tx.verifiedPrincipal = principal and tx.verifiedIssuer = issuer and tx.verifiedSubject = subject else OIDC_VERIFIED_MISMATCH
  update oidcTransactions[id = tx.id] { verifiedPrincipal: principal, verifiedIssuer: issuer, verifiedSubject: subject, email, emailVerified }
  profile = oidcTrustedProfiles[principal = principal]
  if profile != null:
    require profile.issuer = issuer and profile.subject = subject else OIDC_PROFILE_BINDING
  if profile = null or tx.loginOrder > profile.loginOrder:
    -- Five minutes from the managed begin stamp is the fixed recipe policy.
    upsert oidcTrustedProfiles[principal = principal] { issuer, subject, email, emailVerified, evidenceSource: 'login', sourceLogin: tx.id, proofStartedAt: tx.proofStartedAt, proofExpiresAt: tx.proofStartedAt + 300000, loginOrder: tx.loginOrder }
  else if tx.loginOrder = profile.loginOrder:
    require profile.sourceLogin = tx.id and profile.proofStartedAt = tx.proofStartedAt and profile.proofExpiresAt = tx.proofStartedAt + 300000 and profile.email = email and profile.emailVerified = emailVerified else OIDC_PROFILE_REPLAY_MISMATCH
  return null

action beginOidc(bindingHash: text <=64) returns { authorizationUrl: text <=4096 format url } secrets [OIDC_CLIENT_SECRET] retry 3 deadline 10m
action completeOidc(code: text <=4096 ?, state: text <=256, binding: text <=1024, error: text <=200 ?, iss: text <=2048 format url ?) returns { principal: principal, kind: text <=64, token: text <=2048, expiresAt: time } secrets [OIDC_CLIENT_SECRET] retry 3 deadline 10m
