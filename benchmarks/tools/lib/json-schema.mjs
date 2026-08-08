import { isDeepStrictEqual } from 'node:util';

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function propertyPath(path, key) {
  return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function validateNode(schema, value, path, options, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`${path}: field is forbidden by the current schema`);
    return;
  }

  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    errors.push(`${path}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => isDeepStrictEqual(item, value))) {
    errors.push(`${path}: expected one of ${schema.enum.map(JSON.stringify).join(', ')}`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: expected type ${types.join('|')}, received ${value === null ? 'null' : typeof value}`);
      return;
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
    }
  }

  if (schema.format === 'date-time' && value !== null) {
    const time = Date.parse(value);
    if (typeof value !== 'string' || !Number.isFinite(time) || !/^\d{4}-\d\d-\d\dT/.test(value)) {
      errors.push(`${path}: expected an RFC 3339 date-time`);
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => validateNode(schema.items, item, `${path}/${index}`, options, errors));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(`${propertyPath(path, required)}: required field is missing; use null when the schema permits an unmeasured metric`);
      }
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      errors.push(`${path}: expected at least ${schema.minProperties} properties`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) {
        validateNode(schema.properties[key], child, propertyPath(path, key), options, errors);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateNode(schema.additionalProperties, child, propertyPath(path, key), options, errors);
      } else if (schema.additionalProperties === false && !options.tolerateAdditiveFields) {
        errors.push(`${propertyPath(path, key)}: unknown field`);
      }
    }
  }

  for (const member of schema.allOf ?? []) validateNode(member, value, path, options, errors);
  if (schema.if !== undefined) {
    const conditionErrors = [];
    validateNode(schema.if, value, path, options, conditionErrors);
    if (conditionErrors.length === 0 && schema.then !== undefined) {
      validateNode(schema.then, value, path, options, errors);
    } else if (conditionErrors.length > 0 && schema.else !== undefined) {
      validateNode(schema.else, value, path, options, errors);
    }
  }
}

export function validateJsonSchema(schema, value, options = {}) {
  const errors = [];
  validateNode(schema, value, '$', { tolerateAdditiveFields: false, ...options }, errors);
  return errors;
}
