import { isDeepStrictEqual } from "node:util";

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function propertyPath(path, key) {
  return `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function pointerValue(root, hash) {
  if (hash === "" || hash === "#") return root;
  if (!hash.startsWith("#/")) throw new Error(`unsupported JSON Schema fragment ${hash}`);
  return hash.slice(2).split("/").reduce((value, rawPart) => {
    const part = decodeURIComponent(rawPart).replaceAll("~1", "/").replaceAll("~0", "~");
    if (value === undefined || !Object.hasOwn(value, part)) {
      throw new Error(`unresolved JSON Schema pointer ${hash}`);
    }
    return value[part];
  }, root);
}

function resolveReference(reference, context) {
  const resolved = new URL(reference, context.baseUri);
  const hash = resolved.hash;
  resolved.hash = "";
  const documentUri = resolved.href;
  const root = context.registry.get(documentUri);
  if (root === undefined) throw new Error(`unresolved JSON Schema document ${documentUri}`);
  return {
    schema: pointerValue(root, hash),
    context: { ...context, root, baseUri: documentUri },
  };
}

function branchMatches(schema, value, path, context) {
  const branchErrors = [];
  validateNode(schema, value, path, context, branchErrors);
  return branchErrors.length === 0;
}

function validateNode(schema, value, path, context, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`${path}: field is forbidden by the current schema`);
    return;
  }

  if (schema.$ref !== undefined) {
    const target = resolveReference(schema.$ref, context);
    validateNode(target.schema, value, path, target.context, errors);
  }
  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    errors.push(`${path}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => isDeepStrictEqual(item, value))) {
    errors.push(`${path}: expected one of ${schema.enum.map(JSON.stringify).join(", ")}`);
  }
  if (schema.anyOf && !schema.anyOf.some((member) => branchMatches(member, value, path, context))) {
    errors.push(`${path}: value did not match any allowed schema`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((member) => branchMatches(member, value, path, context));
    if (matches.length !== 1) errors.push(`${path}: value must match exactly one allowed schema`);
  }
  if (schema.not && branchMatches(schema.not, value, path, context)) {
    errors.push(`${path}: value matched a forbidden schema`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: expected type ${types.join("|")}, received ${value === null ? "null" : typeof value}`);
      return;
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string is shorter than ${schema.minLength}`);
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern, "u")).test(value)) {
      errors.push(`${path}: string does not match ${schema.pattern}`);
    }
  }

  if (schema.format === "date-time" && value !== null) {
    const time = Date.parse(value);
    if (typeof value !== "string" || !Number.isFinite(time) || !/^\d{4}-\d\d-\d\dT/u.test(value)) {
      errors.push(`${path}: expected an RFC 3339 date-time`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: expected at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        if (value.slice(0, index).some((item) => isDeepStrictEqual(item, value[index]))) {
          errors.push(`${path}/${index}: duplicate array item`);
        }
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateNode(
        schema.items,
        item,
        `${path}/${index}`,
        context,
        errors,
      ));
    }
    if (schema.contains !== undefined) {
      const matches = value.filter((item, index) => (
        branchMatches(schema.contains, item, `${path}/${index}`, context)
      )).length;
      const minimum = schema.minContains ?? 1;
      const maximum = schema.maxContains ?? Number.POSITIVE_INFINITY;
      if (matches < minimum || matches > maximum) {
        errors.push(`${path}: array contains ${matches} matching items, expected ${minimum}..${maximum}`);
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
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
        validateNode(schema.properties[key], child, propertyPath(path, key), context, errors);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateNode(schema.additionalProperties, child, propertyPath(path, key), context, errors);
      } else if (schema.additionalProperties === false && !context.options.tolerateAdditiveFields) {
        errors.push(`${propertyPath(path, key)}: unknown field`);
      }
    }
  }

  for (const member of schema.allOf ?? []) validateNode(member, value, path, context, errors);
  if (schema.if !== undefined) {
    if (branchMatches(schema.if, value, path, context)) {
      if (schema.then !== undefined) validateNode(schema.then, value, path, context, errors);
    } else if (schema.else !== undefined) {
      validateNode(schema.else, value, path, context, errors);
    }
  }
}

export function validateJsonSchema(schema, value, options = {}) {
  const schemas = [schema, ...(options.schemas ?? [])];
  const registry = new Map();
  for (const document of schemas) {
    if (typeof document?.$id !== "string") {
      throw new TypeError("every root JSON Schema must carry an absolute $id");
    }
    registry.set(new URL(document.$id).href, document);
  }
  const errors = [];
  validateNode(schema, value, "$", {
    root: schema,
    baseUri: new URL(schema.$id).href,
    registry,
    options: { tolerateAdditiveFields: false, ...options },
  }, errors);
  return errors;
}
