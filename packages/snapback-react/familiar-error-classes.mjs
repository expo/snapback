// Closed projection table for the familiar live-query alias. The connection
// axis owns transport unavailability; the code set owns continuing-
// subscription authorization denial; every other error code throws.
// @ref LLP 0253#s62-usequery — QueryState carries no denial provenance, so all
// subscription-delivered authorization denials share the unavailable class.
export const FAMILIAR_QUERY_ERROR_CLASSES = Object.freeze({
  unavailableConnections: Object.freeze(['error', 'closed']),
  authorizationDenialCodes: Object.freeze([
    'SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID',
    'SNAPBACK_AUTH_AGENT_DEACTIVATED',
    'SNAPBACK_AUTH_AGENT_DESTROY_CAPABILITY_REQUIRED',
    'SNAPBACK_AUTH_AGENT_INVITATIONS_DISABLED',
    'SNAPBACK_AUTH_AGENT_INVITATION_PROFILE_MISMATCH',
    'SNAPBACK_AUTH_AGENT_INVITATION_USER_INVALID',
    'SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED',
    'SNAPBACK_AUTH_ASSURANCE_INADMISSIBLE',
    'SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED',
    'SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN',
    'SNAPBACK_AUTH_CODE_INVALID',
    'SNAPBACK_AUTH_CODE_LOCKED',
    'SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH',
    'SNAPBACK_AUTH_CREDENTIAL_INVALID',
    'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
    'SNAPBACK_AUTH_DEV_ORIGIN_REFUSED',
    'SNAPBACK_AUTH_FAMILY_REVOKED',
    'SNAPBACK_AUTH_GRANT_INVALID',
    'SNAPBACK_AUTH_GRANT_SCOPE_DENIED',
    'SNAPBACK_AUTH_GUEST_SESSION_INVALID',
    'SNAPBACK_AUTH_IMPERSONATION_REQUIRED',
    'SNAPBACK_AUTH_INTEGRATION_INSTALLATION_REQUIRED',
    'SNAPBACK_AUTH_INTEGRATION_REVOKED',
    'SNAPBACK_AUTH_INTEGRATION_SUSPENDED',
    'SNAPBACK_AUTH_INTEGRATION_TEMPLATE_FORBIDDEN',
    'SNAPBACK_AUTH_INTEGRATION_UNAVAILABLE',
    'SNAPBACK_AUTH_OAUTH_ACCESS_DENIED',
    'SNAPBACK_AUTH_OAUTH_INVALID_CLIENT',
    'SNAPBACK_AUTH_PASSWORD_SET_AUTHORITY_INVALID',
    'SNAPBACK_AUTH_PERMISSION_DENIED',
    'SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN',
    'SNAPBACK_AUTH_RECOVERY_CODE_INVALID',
    'SNAPBACK_AUTH_REFRESH_SUPERSEDED',
    'SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED',
    'SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH',
    'SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED',
    'SNAPBACK_AUTH_REHEARSAL_CONFIG_FORBIDDEN',
    'SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED',
    'SNAPBACK_AUTH_REHEARSAL_EXPIRED',
    'SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN',
    'SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC',
    'SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED',
    'SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED',
    'SNAPBACK_AUTH_REQUIRED',
    'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
    'SNAPBACK_AUTH_SENDER_PROOF_INVALID',
    'SNAPBACK_AUTH_SENDER_PROOF_REPLAYED',
    'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED',
    'SNAPBACK_AUTH_SESSION_EXPIRED',
    'SNAPBACK_AUTH_SESSION_INVALID',
    'SNAPBACK_AUTH_SESSION_REVOKED',
    'SNAPBACK_AUTH_STEP_UP_REQUIRED',
    'SNAPBACK_AUTH_STREAM_RESET',
    'SNAPBACK_AUTH_VERIFIED_PROOF_INVALID',
  ]),
  defaultErrorClass: 'throw',
});

const unavailableConnections = new Set(FAMILIAR_QUERY_ERROR_CLASSES.unavailableConnections);
const authorizationDenialCodes = new Set(FAMILIAR_QUERY_ERROR_CLASSES.authorizationDenialCodes);

export function classifyFamiliarQueryState(state) {
  if ((state.status === 'ready' || state.status === 'refreshing')
    && state.freshness === 'current'
    && state.connection === 'live') {
    return 'data';
  }
  if (state.status === 'blocked') return 'route';
  if (state.status !== 'error') return 'empty';
  if (unavailableConnections.has(state.connection)
    || authorizationDenialCodes.has(state.error?.code)) {
    return 'route';
  }
  return FAMILIAR_QUERY_ERROR_CLASSES.defaultErrorClass;
}

export function isFamiliarAuthorizationDenialCode(code) {
  return authorizationDenialCodes.has(code);
}
