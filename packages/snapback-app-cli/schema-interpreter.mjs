const ANNOTATION_KEYWORDS = new Set([
  '$id', '$schema', 'title', 'description', 'default', 'examples',
  'readOnly', 'writeOnly', 'deprecated',
]);

const SUPPORTED_KEYWORDS = new Set([
  ...ANNOTATION_KEYWORDS,
  '$defs', '$ref', 'type', 'const', 'enum', 'anyOf', 'oneOf', 'allOf', 'not',
  'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength',
]);

function schemaError(message) {
  throw new TypeError(message);
}

function pointerSegment(text) {
  return text.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveLocalRef(root, ref) {
  if (ref === '#') return root;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    schemaError(`external or malformed schema reference ${JSON.stringify(ref)}`);
  }
  let value = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = pointerSegment(raw);
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      schemaError(`unresolved schema reference ${ref}`);
    }
    value = value[key];
  }
  return value;
}

function equalJson(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left)) {
    return Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function childPath(path, key) {
  return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/**
 * Compile the closed JSON-Schema vocabulary emitted for Snapback operation
 * arguments without dynamic code generation. This is deliberately smaller
 * than a general JSON-Schema engine: an unknown construct rejects the signed
 * artifact rather than silently weakening argument admission.
 *
 * @ref LLP 0062#6-packaging-phases — app-bound executables admit inert
 * artifacts without reopening eval or ambient module loading.
 */
export function compileInertSchema(root) {
  if (typeof root !== 'boolean' && (!root || typeof root !== 'object' || Array.isArray(root))) {
    schemaError('schema must be an object or boolean');
  }
  const compiled = new WeakMap();
  const compiling = new WeakSet();

  const compile = (schema) => {
    if (schema === true) return () => null;
    if (schema === false) return (_value, path) => ({ instancePath: path, keyword: 'false schema' });
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) schemaError('subschema must be an object or boolean');
    const existing = compiled.get(schema);
    if (existing) return existing;
    if (compiling.has(schema)) schemaError('recursive schema references are not supported');
    compiling.add(schema);

    for (const keyword of Object.keys(schema)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) schemaError(`unsupported schema keyword ${keyword}`);
    }
    if (schema.$defs !== undefined && (!schema.$defs || typeof schema.$defs !== 'object' || Array.isArray(schema.$defs))) {
      schemaError('$defs must be an object');
    }
    for (const child of Object.values(schema.$defs ?? {})) compile(child);
    if (schema.$ref !== undefined) {
      const target = compile(resolveLocalRef(root, schema.$ref));
      const ownAssertions = Object.keys(schema).filter((key) => !ANNOTATION_KEYWORDS.has(key) && key !== '$ref' && key !== '$defs');
      if (ownAssertions.length > 0) schemaError('$ref siblings are not supported');
      const validator = (value, path) => target(value, path);
      compiled.set(schema, validator);
      compiling.delete(schema);
      return validator;
    }

    const types = schema.type === undefined ? null : (Array.isArray(schema.type) ? schema.type : [schema.type]);
    if (types && (types.length === 0 || types.some((type) => !['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'].includes(type)))) {
      schemaError('type must contain supported JSON types');
    }
    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) schemaError('enum must be a non-empty array');
    const variants = {};
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      if (schema[keyword] !== undefined) {
        if (!Array.isArray(schema[keyword]) || schema[keyword].length === 0) schemaError(`${keyword} must be a non-empty array`);
        variants[keyword] = schema[keyword].map(compile);
      }
    }
    const not = schema.not === undefined ? null : compile(schema.not);
    if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))) {
      schemaError('properties must be an object');
    }
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, child]) => [name, compile(child)]));
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== 'string'))) {
      schemaError('required must be an array of strings');
    }
    const required = schema.required ?? [];
    let additional = schema.additionalProperties;
    if (additional !== undefined && typeof additional !== 'boolean') additional = compile(additional);
    const items = schema.items === undefined ? null : compile(schema.items);
    for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength']) {
      if (schema[keyword] !== undefined && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) schemaError(`${keyword} must be a non-negative integer`);
    }
    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
      if (schema[keyword] !== undefined && (typeof schema[keyword] !== 'number' || !Number.isFinite(schema[keyword]))) schemaError(`${keyword} must be finite`);
    }

    const validator = (value, path) => {
      if (types && !types.some((type) => matchesType(value, type))) return { instancePath: path, keyword: 'type' };
      if (Object.hasOwn(schema, 'const') && !equalJson(value, schema.const)) return { instancePath: path, keyword: 'const' };
      if (schema.enum && !schema.enum.some((candidate) => equalJson(value, candidate))) return { instancePath: path, keyword: 'enum' };
      if (variants.allOf) for (const check of variants.allOf) { const error = check(value, path); if (error) return { instancePath: path, keyword: 'allOf' }; }
      if (variants.anyOf && !variants.anyOf.some((check) => !check(value, path))) return { instancePath: path, keyword: 'anyOf' };
      if (variants.oneOf && variants.oneOf.filter((check) => !check(value, path)).length !== 1) return { instancePath: path, keyword: 'oneOf' };
      if (not && !not(value, path)) return { instancePath: path, keyword: 'not' };
      if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) return { instancePath: path, keyword: 'minimum' };
        if (schema.maximum !== undefined && value > schema.maximum) return { instancePath: path, keyword: 'maximum' };
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return { instancePath: path, keyword: 'exclusiveMinimum' };
        if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return { instancePath: path, keyword: 'exclusiveMaximum' };
      }
      if (typeof value === 'string') {
        if (schema.minLength !== undefined && [...value].length < schema.minLength) return { instancePath: path, keyword: 'minLength' };
        if (schema.maxLength !== undefined && [...value].length > schema.maxLength) return { instancePath: path, keyword: 'maxLength' };
      }
      if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) return { instancePath: path, keyword: 'minItems' };
        if (schema.maxItems !== undefined && value.length > schema.maxItems) return { instancePath: path, keyword: 'maxItems' };
        if (items) for (let index = 0; index < value.length; index += 1) { const error = items(value[index], childPath(path, index)); if (error) return error; }
      }
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const name of required) if (!Object.hasOwn(value, name)) return { instancePath: path, keyword: 'required' };
        for (const [name, member] of Object.entries(value)) {
          const property = properties[name];
          if (property) { const error = property(member, childPath(path, name)); if (error) return error; }
          else if (additional === false) return { instancePath: childPath(path, name), keyword: 'additionalProperties' };
          else if (typeof additional === 'function') { const error = additional(member, childPath(path, name)); if (error) return error; }
        }
      }
      return null;
    };
    compiled.set(schema, validator);
    compiling.delete(schema);
    return validator;
  };

  const check = compile(root);
  const validate = (value) => {
    const error = check(value, '');
    validate.errors = error ? [error] : null;
    return error === null;
  };
  validate.errors = null;
  return validate;
}
