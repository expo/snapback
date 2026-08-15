// Canonical generated operation-name grammar shared by authoring and clients.
//
// @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1 —
// one plain identifier or exactly one identifier-qualified leaf is the complete
// public grammar; a generated name must survive canonical client admission.

export const OPERATION_IDENTIFIER_PATTERN_SOURCE = '[A-Za-z_][A-Za-z0-9_]*';
export const OPERATION_NAME_PATTERN_SOURCE = `^(?:${OPERATION_IDENTIFIER_PATTERN_SOURCE})(?:\\.${OPERATION_IDENTIFIER_PATTERN_SOURCE})?$`;
export const OPERATION_NAME_PATTERN = new RegExp(OPERATION_NAME_PATTERN_SOURCE, 'u');

export function isOperationName(value) {
  return typeof value === 'string' && OPERATION_NAME_PATTERN.test(value);
}
