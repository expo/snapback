import { readFileSync } from 'node:fs';

export const fixtureRoot = new URL('../../benchmarks/fixtures/social-messenger/', import.meta.url);
export const readJSON = name => JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
const schema = readJSON('action-schema.json');
const verbs = new Map(schema.verbs.map(verb => [verb.name, verb]));
const patterns = new Map();
const matches = (pattern, value) => {
  if (!patterns.has(pattern)) patterns.set(pattern, new RegExp(pattern));
  return patterns.get(pattern).test(value);
};
const require = (ok, message) => { if (!ok) throw new Error(message); };

function tokenize(line) {
  const tokens = [];
  const pattern = /[ \t]*("(?:[^"\\\r\n]|\\[^\r\n])*"|[^\x00-\x20"\x7f]+)(?=[ \t]|$)/y;
  let offset = 0;
  while (offset < line.length && !/^[ \t]*$/.test(line.slice(offset))) {
    pattern.lastIndex = offset;
    const match = pattern.exec(line);
    require(match, `invalid token at column ${offset + 1}`);
    const quoted = match[1].startsWith('"');
    tokens.push({ value: quoted ? JSON.parse(match[1]) : match[1], quoted });
    offset = pattern.lastIndex;
  }
  return tokens;
}

function validate(token, spec) {
  require(token && token.quoted === Boolean(spec.quoted), `${spec.name}: wrong quoting or missing argument`);
  const value = token.value;
  const type = { ...schema.types[spec.type], ...spec };
  require(!type.pattern || matches(type.pattern, value), `${spec.name}: invalid ${spec.type}`);
  require(!type.values || type.values.includes(value), `${spec.name}: expected ${type.values}`);
  const length = [...value].length;
  require(length >= (type.minLength ?? 0) && length <= (type.maxLength ?? Infinity), `${spec.name}: invalid length`);
  require(!type.extensions || type.extensions.some(ext => value.endsWith(ext)), `${spec.name}: wrong extension`);
  if (spec.type === 'imageList') {
    const paths = value.split(type.separator);
    require(paths.length >= type.minItems && paths.length <= type.maxItems &&
      paths.every(path => matches(type.itemPattern, path)), `${spec.name}: invalid image list`);
  }
  if (spec.type === 'option') {
    require(value.startsWith(spec.prefix), `${spec.name}: expected ${spec.prefix}`);
    return validate({ value: value.slice(spec.prefix.length), quoted: false }, { name: spec.name, type: spec.valueType });
  }
  return value;
}

export function parseAction(line) {
  if (schema.lexicalGrammar.checkpointMarkers.includes(line)) return { checkpoint: line.slice('# checkpoint '.length) };
  const [timestamp, actor, verb, ...args] = tokenize(line);
  require(timestamp && !timestamp.quoted && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(timestamp.value), 'invalid UTC timestamp');
  const at = Date.parse(timestamp.value);
  require(Number.isFinite(at) && new Date(at).toISOString() === timestamp.value.replace('Z', '.000Z'), 'invalid UTC date');
  const actorId = validate(actor, { name: 'actor', type: 'actorId' });
  require(verb && !verb.quoted && verbs.has(verb.value), `unknown verb ${verb?.value}`);
  const errors = [];
  for (const variant of verbs.get(verb.value).variants) {
    try {
      require(args.length >= variant.arguments.filter(arg => !arg.optional).length &&
        args.length <= variant.arguments.length, 'wrong argument count');
      const values = Object.fromEntries(variant.arguments.flatMap((spec, i) =>
        !args[i] && spec.optional ? [] : [[spec.name, validate(args[i], spec)]]));
      for (const rule of variant.constraints ?? []) {
        if (rule.kind === 'extensionByEnum') require(rule.extensions[values[rule.enumArgument]].some(ext =>
          values[rule.pathArgument].endsWith(ext)), 'media kind and extension disagree');
        else if (rule.kind === 'forbidPair') require(!(values[rule.firstArgument] === rule.firstValue &&
          values[rule.secondArgument] === rule.secondValue), 'forbidden media kind/mode');
        else throw new Error(`unsupported grammar constraint ${rule.kind}`);
      }
      return { actorId, verb: verb.value, at, args: values };
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(`${verb.value}: ${errors.join('; ')}`);
}
