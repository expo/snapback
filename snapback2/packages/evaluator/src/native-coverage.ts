// @ref LLP 1012#native-acquisition-restart — a native log prefix is read coverage, never an ordinary authority fact.
import { canonicalSchemaJson } from './certificate-identity';
import { decodeCursorFor } from './cursor';
import { fail } from './errors';
import { compareCodepoints } from './hash';
import { canonicalJson, compareArrays, fieldOrNull, scopedRuleHash, validateColumnValue } from './value-runtime';
import type { LogicalIndexAtom } from './search-key';
import type { TraceRange, Value } from './types';

/** The validated transport admits pages only after their rows are durably committed. */
export interface NativeLogCoverage {
  log: string;
  recipient: string;
  after: string | null;
  cursor: string | null;
  exhausted: boolean;
}

type Chain = { cursor: string | null; exhausted: boolean; intact: boolean };
const index = (columns: string[], unique = false) => ({ components: columns.map(Column => ({ Column })), unique });

/** Ownership comes from a deliver declaration AND the canonical generated table, not its spelling. */
function canonicalLog(schema: any, log: string): any {
  const declarations = Object.entries<any>(schema.tables).filter(([, table]) => table.deliver);
  const owners = declarations.filter(([, table]) => table.deliver.log === log);
  if (owners.length !== 1 || declarations.some(([, table]) => table.deliver.receipts && `${table.deliver.log}Receipts` === log))
    fail('E_INPUT', 'native coverage requires one generated delivery log');
  const [content, source] = owners[0], d = source.deliver, target = schema.tables[d.target];
  if (!target || log === content || log === d.target || d.target === '_connected' || !Array.isArray(d.prefix) || !d.prefix.length
    || new Set(d.prefix).size !== d.prefix.length || target.columns[d.principal] !== 'Principal'
    || declarations.some(([, table]) => table.deliver.log === d.target || table.deliver.receipts && `${table.deliver.log}Receipts` === d.target)
    || (schema.maintains ?? []).some((m: any) => m.target === content))
    fail('E_INPUT', 'native coverage requires a canonical deliver declaration');
  const columns: Record<string, any> = { id: 'Id', recipient: 'Principal', row: { Ref: { table: content } },
    incarnation: 'Int', kind: { Enum: { variants: ['delivered', 'changed', 'removed'] } }, audience: 'Int', seq: 'Int', at: 'Time' };
  for (const name of d.prefix) {
    if (typeof name !== 'string' || Object.hasOwn(columns, name) || !Object.hasOwn(source.columns, name)
      || canonicalJson(source.columns[name]) !== canonicalJson(target.columns[name]))
      fail('E_INPUT', 'native coverage requires a canonical deliver prefix');
    columns[name] = source.columns[name];
  }
  if (!(target.constraints ?? []).some((c: any) => c.Cap && Number.isSafeInteger(c.Cap.max) && c.Cap.max >= 0
    && canonicalJson(c.Cap.by) === canonicalJson(d.prefix))
    || !Object.values<any>(target.indexes).some(i => d.prefix.every((name: string, n: number) => i.components[n]?.Column === name)))
    fail('E_INPUT', 'native coverage requires a capped delivery audience');
  const expected = { columns, indexes: {
    byId: index(['id'], true), byRecipient: index(['recipient', 'seq', 'id']),
    byRecipientGroup: index(['recipient', ...d.prefix, 'kind', 'seq', 'id']), byRow: index(['row', 'kind', 'recipient']),
  }, rules: { read: { Eq: [{ Field: 'recipient' }, 'Viewer'] }, insert: 'Deny', update: 'Deny', delete: 'Deny' },
  constraints: [{ Immutable: { fields: Object.keys(columns).filter(c => c !== 'id').sort(compareCodepoints) } }],
  retain: 'until-revoked', tombstones: [{ table: content, column: 'row', when: { Eq: [{ Field: 'kind' }, { Literal: { String: 'removed' } }] } }] };
  const actual = schema.tables[log];
  if (!actual || canonicalSchemaJson({ tables: { [log]: actual }, maintains: [] })
    !== canonicalSchemaJson({ tables: { [log]: expected }, maintains: [] }))
    fail('E_INPUT', 'native coverage requires the canonical generated log shape');
  return actual;
}

export class NativeCoverage {
  private logs = new Map<string, { rule: string; recipients: Map<string, Chain> }>();
  constructor(private readonly schema: any) {}

  validate(pages: NativeLogCoverage[]): void {
    const copy = new NativeCoverage(this.schema);
    for (const [log, owner] of this.logs) copy.logs.set(log, { rule: owner.rule,
      recipients: new Map([...owner.recipients].map(([recipient, chain]) => [recipient, { ...chain }])) });
    for (const page of pages) copy.admit(page);
  }

  /** Persist only reusable prefixes. Lost evidence requires reacquisition from
   * the root; an empty prefix with a newly observed row likewise starts there. */
  positions(recipient: string): Record<string, { cursor: string | null; exhausted: boolean }> {
    const positions: Record<string, { cursor: string | null; exhausted: boolean }> = Object.create(null);
    for (const [log, owner] of this.logs) {
      const chain = owner.recipients.get(recipient);
      if (chain?.intact && (chain.cursor !== null || chain.exhausted))
        positions[log] = { cursor: chain.cursor, exhausted: chain.exhausted };
    }
    return positions;
  }

  admit(page: NativeLogCoverage): void {
    if (!page || typeof page.log !== 'string' || typeof page.recipient !== 'string' || typeof page.exhausted !== 'boolean'
      || page.after !== null && typeof page.after !== 'string' || page.cursor !== null && typeof page.cursor !== 'string')
      fail('E_INPUT', 'invalid native coverage page');
    const held = this.logs.get(page.log);
    const definition = held ? this.schema.tables[page.log] : canonicalLog(this.schema, page.log);
    validateColumnValue(this.schema, page.log, 'recipient', { Id: page.recipient });
    const position = (token: string | null): Value[] | null => token === null ? null :
      (decodeCursorFor(token, { table: page.log, index: 'byRecipient', order: 'Asc',
        suffix: [{ name: 'seq', kind: 'Int' }, { name: 'id', kind: 'Id' }] }, this.schema) as { Array: Value[] }).Array;
    const after = position(page.after), cursor = position(page.cursor), previous = held?.recipients.get(page.recipient);
    if (page.after !== null && (!previous?.intact || previous.cursor !== page.after))
      fail('E_INPUT', 'native coverage pages must form a contiguous prefix');
    if (after && (!cursor || compareArrays(cursor, after) < 0)
      || !page.exhausted && (!cursor || page.cursor === page.after))
      fail('E_INPUT', 'native coverage cursor must advance unless exhausted');
    const owner = held ?? { rule: scopedRuleHash(this.schema, definition.rules.read), recipients: new Map<string, Chain>() };
    owner.recipients.set(page.recipient, { cursor: page.cursor, exhausted: page.exhausted, intact: true });
    this.logs.set(page.log, owner);
  }

  covers(range: TraceRange, logical: LogicalIndexAtom[], viewer: string): boolean {
    const owner = this.logs.get(range.table), prefix = logical[0];
    if (!owner || range.index !== 'byRecipient' || range.rule_hash !== owner.rule || logical.length !== 1
      || !prefix || !('Scalar' in prefix) || typeof prefix.Scalar !== 'object' || !('Id' in prefix.Scalar)
      || prefix.Scalar.Id !== viewer) return false;
    const chain = owner.recipients.get(viewer);
    return !!chain?.intact && chain.exhausted;
  }

  changed(table: string, old: Value | null, next: Value | null): void {
    const owner = this.logs.get(table); if (!owner) return;
    for (const row of [old, next]) if (row) {
      const recipient = fieldOrNull(row, 'recipient');
      const chain = typeof recipient === 'object' && 'Id' in recipient ? owner.recipients.get(recipient.Id) : undefined;
      if (chain) {
        chain.exhausted = false;
        // Additions can extend the next page; loss/replacement of retained evidence cannot.
        if (old) chain.intact = false;
      }
    }
  }
}
