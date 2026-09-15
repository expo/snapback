// Lane-vendored shim for the `../../lib/json-schema.mjs` import that the
// instrument snapshot does not ship (only choreography/ was snapshotted).
// Same contract as the repository helper: validateJsonSchema(schema, data)
// returns an array of error strings (empty when valid).
import Ajv2020 from "ajv/dist/2020.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export function validateJsonSchema(schema, data) {
  try {
    const validate = ajv.compile(schema);
    const ok = validate(data);
    if (ok) return [];
    return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
  } catch (err) {
    return [`validator error: ${err?.message ?? err}`];
  }
}
