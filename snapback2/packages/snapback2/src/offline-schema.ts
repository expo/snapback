// One hasher of the schema: the evaluator's struct-order canonical form, the
// same code the twin runs, proven against Rust's `Schema::hash()` on every golden.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — closure reconstruction is admitted only under the envelope's exact generation schema.
import { canonicalSchemaJson } from "../../evaluator/src/certificate-identity.js";
import { sha256 } from "../../evaluator/src/hash.js";

export function schemaDigest(schema: any): string {
  return sha256(canonicalSchemaJson(schema));
}
