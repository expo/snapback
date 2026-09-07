// @ref LLP 1001#10-what-binds-and-how-it-is-checked — native canonical field
// order and malformed/default refusal policies belong to the fixed grammar.
import { structural, type Form, type Grammar } from './structural-codec';

// These public boundary adapters retain the original root property/method failure
// sites. Nested construction and validation are performed by the shared codec.
export function canonicalProgramJson(program: any): string {
  const out = structural(program, ['record', 'program', ['name','kind','args','read_time_granularity_ms','body']], grammar);
  out.args = structural(program.args ?? {}, ['map', 'arg'], grammar);
  out.body = (program.body ?? []).map(normalizeStatement);
  return JSON.stringify(out);
}

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — skip/unknown
// policies preserve authenticated identity; they do not admit an unknown program.
export function canonicalSchemaJson(schema: any): string {
  structural(schema, ['record', 'schema', ['tables','schedules','maintains','channels','auth','effects'], null, 'validate'], grammar);
  const canonical: Record<string, any> = { tables: structural(schema.tables ?? {}, ['map', 'table'], grammar) };
  if (schema.schedules !== undefined && schema.schedules.length > 0)
    canonical.schedules = schema.schedules.map(normalizeSchedule);
  canonical.maintains = (schema.maintains ?? []).map(normalizeMaintain);
  if (schema.channels !== undefined && Object.keys(schema.channels).length > 0)
    canonical.channels = structural(schema.channels, ['map', 'channel'], grammar);
  if (schema.auth !== undefined && schema.auth !== null)
    structural(schema.auth, ['record', 'auth', ['password','guests'], null, 'validate'], grammar);
  if (schema.auth !== undefined && (schema.auth.password || schema.auth.guests))
    canonical.auth = { password: schema.auth.password, guests: schema.auth.guests };
  if (schema.effects !== undefined && schema.effects.length > 0) canonical.effects = schema.effects;
  return JSON.stringify(canonical);
}
export function canonicalRuleJson(rule: any): string { return JSON.stringify(normalizeRule(rule)); }
export function normalizeRule(rule: any): any { return structural(rule, 'rule', grammar); }

// Named boundary callbacks preserve native malformed-root error text. All
// constructor work is dispatched to the grammar, with no private legacy walker.
const normalizeStatement = (value: any) => structural(value, 'statement', grammar);
const normalizeSchedule = (value: any) => structural(value, 'schedule', grammar);
const normalizeMaintain = (value: any) => structural(value, 'maintain', grammar);

// Only fixed source descriptions are allocated here. No constructor closes over
// an input, and no normalized schema or second IR tree survives a call.
const record = (name: string | null, fields: Record<string, Form>, complete = false, pre: any[] = []): Form =>
  ['record', name, Object.keys(fields), Object.fromEntries(Object.entries(fields).filter(([, rule]) => rule !== null)), complete, pre];
const list = (of: Form, receiver = 'value'): Form => ['list', of, 'map', receiver];
const nullable = (of: Form): Form => ['nullable', false, of];
const defaults = (value: any, of: Form): Form => ['default', 'nullish', value, of];
const map = (of: Form): Form => ['map', of];
const opaque = (cases: Record<string, Form>): Form => ['variant', cases, 'opaque'];
const columnFields: Record<string, Form> = {
  Text: record('column.Text', { max: null }), Bytes: record('column.Bytes', { max: null }),
  Video: record('column.Video', { max: null }), Enum: record('column.Enum', { variants: null }),
  Decimal: record('column.Decimal', { scale: null }), Money: record('column.Money', { currency: null, scale: null }),
  Ref: record('column.Ref', { table: null }), Json: record('column.Json', { max_bytes: null }),
};
const read = record('read', { site: null, table: null, index: null, key: list('expression'), provenance: null });
const grammar: Grammar = {
  column: ['variant', {
    ...columnFields, Optional: 'column', List: record('column.List', { of: 'column', max: null }),
    Image: record('column.Image', { max: null, once: ['omit', 'unlessTrue', null] }, true,
      [['once', ['check','boolean','column.Image.once must be boolean']]]),
  }, 'deep', 'primitive', 'column.'],
  arg: ['variant', {
    Optional: 'arg',
    Text: record('arg.Text', { max: null, min: ['omit','falsy',null], format: null }, true,
      [['min', ['check','u32','arg.Text.min must be u32']], ['format', ['check','format','arg.Text.format must be handle or url']]]),
    List: record('arg.List', { of: ['omit','nullish','arg'], max: null }, true),
  }, 'column', 'primitive'],
  table: record('table', { columns: defaults({}, map('column')), indexes: defaults({}, map('index')),
    rules: ['nullable',true,'rules'], constraints: defaults([],list('constraint','(value ?? [])')), retain: defaults('until-revoked',null) }, true),
  index: record('index', { components: list('component'), unique: null }),
  component: ['variant', { Column: null, WordPrefixes: record('WordPrefixes', { fields: null, contract: null }) }, 'error:unknown index component'],
  rules: record('rules', { read: 'rule', insert: 'rule', update: 'rule', delete: 'rule' }, true),
  channel: record('channel', { args: defaults({},map('arg')), publish: 'rule', subscribe: 'rule', ttl_ms: null }, true),
  maintain: record('maintain', { kind: 'maintainKind', source: null, by: null, target: null, readable: defaults(null,nullable('rule')) }, true),
  maintainKind: ['variant', { Sum: record('maintain.kind.Sum', { of: null }) }, 'deep', 'primitive'],
  // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — site is diagnostic-only and omitted from identity.
  schedule: ['record','schedule',['name','trigger','target','binding','site'], { site: ['omit','always',null], trigger: 'trigger' }],
  trigger: ['variant', { row: record('schedule trigger', { table: null, column: null }), every: record('schedule trigger', { durationMs: null }) }, 'deep'],
  value: ['variant', { Array: list('value','data'), Row: map('value'), Map: map('value') }, 'whole', 'string'],
  ruleTerm: ['variant', { Literal: 'value', Field: null, OldField: null, NextField: null }, 'deep', 'primitive'],
  rule: ['variant', {
    Eq: list('ruleTerm'), Ne: list('ruleTerm'), And: list('rule'), Or: list('rule'), Not: 'rule',
    Exists: record('rule.Exists', { table: null, index: null, key: list('ruleTerm'), provenance: null }),
    Created: record('rule.Created', { table: null, index: null, key: list('ruleTerm'), provenance: null }),
    Public: record('rule.Public', { reason: null }),
  }, 'deep', 'primitive'],
  constraint: ['variant', {
    Unique: record('constraint.Unique', { index: null }), Cap: record('constraint.Cap', { by: null, max: null }),
    Immutable: record('constraint.Immutable', { fields: null }),
    Text: record('constraint.Text', { field: null, min: defaults(0,null), format: ['omit','nullish',null] }, true),
    FinalExistsOnInsert: record('constraint.FinalExistsOnInsert', { table: null, index: null, key: list('ruleTerm') }),
  }, 'deep', 'primitive'],
  statement: ['variant', {
    Const: record('Const', { name: null, value: 'expression' }), Let: record('Let', { name: null, value: 'expression' }),
    Assign: record('Assign', { name: null, value: 'expression' }), Push: record('Push', { target: null, value: 'expression' }),
    If: record('If', { condition: 'expression', then_body: list('statement'), else_body: list('statement') }),
    For: record('For', { binding: null, domain: 'domain', body: list('statement') }),
    Require: record('Require', { condition: 'expression', code: null }),
    Insert: record('Insert', { table: null, row: 'expression' }),
    Update: record('Update', { table: null, key: 'expression', patch: 'expression' }),
    Upsert: record('Upsert', { table: null, key: 'expression', row: 'expression' }), Delete: record('Delete', { table: null, key: 'expression' }),
    Emit: record('Emit', { effect: null, payload: 'expression' }), Return: 'expression',
  }, 'whole', 'string', true],
  domain: opaque({ Page: 'scan',
    DerivedArray: record('DerivedArray', { value: 'expression', max: null, bound_source: null }),
    Recurse: record('Recurse', { site: null, table: null, index: null, seed: 'expression', next_field: null, depth: null, fanout: null, provenance: null }),
    LiteralRange: record('LiteralRange', { start: null, end_exclusive: null }), ArgList: record('ArgList', { name: null, max: null }),
  }),
  expression: ['variant', {
    Literal: 'value', Field: record('Field', { base: 'expression', name: null }), Array: list('expression'), Object: map('expression'),
    Binary: record('Binary', { op: null, left: 'expression', right: 'expression' }), Unary: record('Unary', { op: null, value: 'expression' }),
    Builtin: record('Builtin', { builtin: null, args: list('expression') }), Get: read, Exists: read, Scan: 'scan',
    Merge: record('Merge', { site: null, lanes: list(['lane'],'lanes'), held_search: ['truthy','held'] }),
  }, 'whole'],
  scan: ['record','scan',['site','table','index','prefix','order','take','after','before','range','opaque_cursor','merge_site','provenance'], {
    take: 'bound', prefix: list('key'), after: nullable('expression'), before: nullable('expression'),
    range: nullable(record('range', { gt: nullable('expression'), gte: nullable('expression'), lt: nullable('expression'), lte: nullable('expression') })),
  }],
  bound: opaque({ Arg: record('bound', { name: null, max: null }) }),
  key: ['variant', { Scalar: 'expression', WordPrefix: record('WordPrefix', { source: 'expression', contract: null, source_max: null }) }, 'error:unknown index key expression'],
  held: record('held_search', {
    table: null, index: null,
    term: record(null, { source: 'expression', contract: null, source_max: null }, true),
    scope: ['scope'],
    suffix: null, order: null, take: 'bound', after: nullable('expression'),
    discovery: record(null, { scan: 'scan', binding: null, authorization_index: null }, true),
  }, true),
};
