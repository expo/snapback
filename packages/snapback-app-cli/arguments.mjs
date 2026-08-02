import Ajv2020 from 'ajv/dist/2020.js';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  // Successive served generations legitimately reuse a schema's canonical
  // $id while changing its content. Each admitted object is compiled and
  // cached by identity; it must not enter Ajv's process-global $id registry.
  addUsedSchema: false,
  loadSchema: undefined,
});
const validators = new WeakMap();

const fail = (code, message, details = undefined) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({ code, message, ...(details === undefined ? {} : { details }) });
  return error;
};

export function validateFunctionArgs(fn, args) {
  const schema = fn?.argsSchema;
  // Compatibility for the earliest local artifact checkpoint, which carried
  // only a path. Current generated and served surfaces carry the inert schema
  // object and therefore take the full admission below.
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return args;
  let validate = validators.get(schema);
  if (validate === undefined) {
    try {
      validate = ajv.compile(schema);
    } catch (cause) {
      throw fail(
        'SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH',
        `argument schema for '${fn.name}' is not self-contained and admissible`,
        { functionId: fn.id },
      );
    }
    validators.set(schema, validate);
  }
  if (!validate(args)) {
    throw fail(
      'SNAPBACK_APP_CLI_USAGE',
      `arguments for '${fn.name}' do not satisfy its generated schema`,
      {
        functionId: fn.id,
        errors: validate.errors?.slice(0, 16).map((error) => ({
          instancePath: error.instancePath,
          keyword: error.keyword,
        })) ?? [],
      },
    );
  }
  return args;
}
