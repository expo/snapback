// Authoring source for the LLP 0051 D5 result-transform.v1 extension.
// Committed *.case.json files remain the cross-language contract.
//
// @ref LLP 0166#the-evaluation-model-result-transformv1 — cases pin every
//   pipeline stage, the total comparator, limit semantics, and closed refusals.

export const RESULT_TRANSFORM_CORPUS_NAME = 'snapback-data-tier.result-transform-v1';
export const RESULT_TRANSFORM_CORPUS_VERSION = 1;
export const RESULT_TRANSFORM_FIXTURE_KEY = 'qmk1.result-transform-fixture';

export const CODES = Object.freeze({
  PLAN_INVALID: 'SNAPBACK_RESULT_TRANSFORM_PLAN_INVALID',
  STAGE_UNKNOWN: 'SNAPBACK_RESULT_TRANSFORM_STAGE_UNKNOWN',
  COMPARATOR_UNKNOWN: 'SNAPBACK_RESULT_TRANSFORM_COMPARATOR_UNKNOWN',
  NORMALIZATION_UNADMITTED: 'SNAPBACK_RESULT_TRANSFORM_NORMALIZATION_UNADMITTED',
  FIELD_UNPROJECTED: 'SNAPBACK_RESULT_TRANSFORM_FIELD_UNPROJECTED',
  ORDER_FIELD_DUPLICATE: 'SNAPBACK_RESULT_TRANSFORM_ORDER_FIELD_DUPLICATE',
  LIMIT_INVALID: 'SNAPBACK_RESULT_TRANSFORM_LIMIT_INVALID',
  CROSS_ADDRESS: 'SNAPBACK_RESULT_TRANSFORM_CROSS_ADDRESS',
  NON_SCALAR: 'SNAPBACK_RESULT_TRANSFORM_NON_SCALAR',
  BASE_INVALID: 'SNAPBACK_RESULT_TRANSFORM_BASE_INVALID',
  MIXED_VERSION: 'SNAPBACK_RESULT_TRANSFORM_MIXED_VERSION',
  OVERLAY_INPUT_REQUIRED: 'SNAPBACK_RESULT_TRANSFORM_OVERLAY_INPUT_REQUIRED',
});

const DEFAULT_FIELDS = Object.freeze([
  'id',
  'value',
  'group',
  'rank',
  'tie',
  'active',
  'name',
]);

const plan = (overrides = {}) => ({
  format: 'snapback.result-transform.v1',
  materializationKey: RESULT_TRANSFORM_FIXTURE_KEY,
  overlay: 'none',
  filterGrammar: 'basic-v1',
  filter: [],
  order: [],
  limit: null,
  ...overrides,
});

const singleBase = (rows, overrides = {}) => ({
  shape: 'row-sequence',
  mode: 'single-page',
  pages: [{ version: 'stream-v7', terminal: true, rows }],
  ...overrides,
});

const chainBase = (pages) => ({
  shape: 'row-sequence',
  mode: 'complete-page-set',
  pages,
});

const ok = (rows) => ({ status: 'ok', rows });
const refused = (code, reason) => ({ status: 'refused', code, reason });

const corpusCase = ({
  name,
  notes,
  transformPlan = plan(),
  executingMaterializationKey = RESULT_TRANSFORM_FIXTURE_KEY,
  projectedFields = DEFAULT_FIELDS,
  base = singleBase([]),
  clientOverlayRows,
  outcome,
}) => ({
  corpus: RESULT_TRANSFORM_CORPUS_NAME,
  corpusVersion: RESULT_TRANSFORM_CORPUS_VERSION,
  name,
  notes,
  plan: transformPlan,
  executingMaterializationKey,
  projectedFields: [...projectedFields],
  base,
  ...(clientOverlayRows === undefined ? {} : { clientOverlayRows }),
  expect: { outcome },
});

export function buildResultTransformCorpusCases() {
  const values = [
    { id: 'num', value: 5 },
    { id: 'bool', value: false },
    { id: 'string', value: 'b' },
    { id: 'null', value: null },
  ];
  const limits = [
    { id: 'a', value: 3 },
    { id: 'b', value: 1 },
    { id: 'c', value: 2 },
  ];

  const cases = [
    corpusCase({
      name: 'base-single-page-established-order',
      notes: 'Base assembly preserves one requested page in established row order.',
      base: singleBase([{ id: 'b' }, { id: 'a' }]),
      outcome: ok([{ id: 'b' }, { id: 'a' }]),
    }),
    corpusCase({
      name: 'base-complete-page-chain',
      notes: 'A complete page set concatenates first-to-terminal and preserves each page order.',
      base: chainBase([
        { version: 'stream-v7', terminal: false, rows: [{ id: 'a' }, { id: 'b' }] },
        { version: 'stream-v7', terminal: true, rows: [{ id: 'c' }] },
      ]),
      outcome: ok([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    }),
    corpusCase({
      name: 'base-empty-result',
      notes: 'An established empty row sequence transforms to an exact empty row sequence.',
      outcome: ok([]),
    }),
    corpusCase({
      name: 'overlay-only-row',
      notes: 'The client-materialized overlay input may add the only visible row before filtering.',
      transformPlan: plan({ overlay: 'apply' }),
      clientOverlayRows: [{ id: 'optimistic', value: 1 }],
      outcome: ok([{ id: 'optimistic', value: 1 }]),
    }),
    corpusCase({
      name: 'overlay-shadowing-base-row',
      notes: 'The client-materialized overlay input may shadow a base row without server callback evaluation.',
      transformPlan: plan({ overlay: 'apply' }),
      base: singleBase([{ id: 'one', name: 'base' }]),
      clientOverlayRows: [{ id: 'one', name: 'optimistic' }],
      outcome: ok([{ id: 'one', name: 'optimistic' }]),
    }),
    corpusCase({
      name: 'filter-eq',
      notes: 'eq uses canonical scalar equality without cross-type coercion.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'eq', value: 1 }] }),
      base: singleBase([{ id: 'n', value: 1 }, { id: 's', value: '1' }]),
      outcome: ok([{ id: 'n', value: 1 }]),
    }),
    corpusCase({
      name: 'filter-ne',
      notes: 'ne is the complement of canonical scalar equality.',
      transformPlan: plan({ filter: [{ field: 'active', op: 'ne', value: true }] }),
      base: singleBase([{ id: 'a', active: true }, { id: 'b', active: false }]),
      outcome: ok([{ id: 'b', active: false }]),
    }),
    corpusCase({
      name: 'filter-lt-cross-type',
      notes: 'Range filters use the total type rank, so every non-string scalar is less than a string.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'lt', value: 'a' }] }),
      base: singleBase(values),
      outcome: ok([values[0], values[1], values[3]]),
    }),
    corpusCase({
      name: 'filter-lte',
      notes: 'lte includes numeric equality.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'lte', value: 2 }] }),
      base: singleBase([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }]),
      outcome: ok([{ id: 'a', value: 1 }, { id: 'b', value: 2 }]),
    }),
    corpusCase({
      name: 'filter-gt',
      notes: 'gt excludes numeric equality.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'gt', value: 2 }] }),
      base: singleBase([{ id: 'a', value: 2 }, { id: 'b', value: 3 }]),
      outcome: ok([{ id: 'b', value: 3 }]),
    }),
    corpusCase({
      name: 'filter-gte',
      notes: 'gte includes numeric equality.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'gte', value: 2 }] }),
      base: singleBase([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }]),
      outcome: ok([{ id: 'b', value: 2 }, { id: 'c', value: 3 }]),
    }),
    corpusCase({
      name: 'filter-in',
      notes: 'in is a disjunction of canonical scalar equality over a nonempty array.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'in', value: [null, 'x'] }] }),
      base: singleBase([{ id: 'a', value: null }, { id: 'b', value: 'x' }, { id: 'c', value: false }]),
      outcome: ok([{ id: 'a', value: null }, { id: 'b', value: 'x' }]),
    }),
    corpusCase({
      name: 'filter-conjunction',
      notes: 'Filter entries compose as a conjunction in declaration order.',
      transformPlan: plan({ filter: [
        { field: 'group', op: 'eq', value: 'g' },
        { field: 'rank', op: 'gte', value: 2 },
      ] }),
      base: singleBase([
        { id: 'a', group: 'g', rank: 1 },
        { id: 'b', group: 'g', rank: 2 },
        { id: 'c', group: 'h', rank: 3 },
      ]),
      outcome: ok([{ id: 'b', group: 'g', rank: 2 }]),
    }),
    corpusCase({
      name: 'filter-absent-field-is-null',
      notes: 'An absent projected field reads as null during filtering.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'eq', value: null }] }),
      base: singleBase([{ id: 'missing' }, { id: 'present', value: 0 }]),
      outcome: ok([{ id: 'missing' }]),
    }),
    corpusCase({
      name: 'filter-equality-mixed-types',
      notes: 'Canonical equality does not equate number, string, or boolean spellings.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'eq', value: 1 }] }),
      base: singleBase([{ id: 'n', value: 1 }, { id: 's', value: '1' }, { id: 'b', value: true }]),
      outcome: ok([{ id: 'n', value: 1 }]),
    }),
    corpusCase({
      name: 'order-total-type-rank-asc',
      notes: 'Ascending order freezes null < boolean < number < string across mixed scalars.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc' }] }),
      base: singleBase([
        { id: 'string', value: 'a' },
        { id: 'true', value: true },
        { id: 'number', value: 0 },
        { id: 'null', value: null },
        { id: 'false', value: false },
      ]),
      outcome: ok([
        { id: 'null', value: null },
        { id: 'false', value: false },
        { id: 'true', value: true },
        { id: 'number', value: 0 },
        { id: 'string', value: 'a' },
      ]),
    }),
    corpusCase({
      name: 'order-total-type-rank-desc',
      notes: 'Descending reverses the same total comparator, including type rank.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'desc' }] }),
      base: singleBase([
        { id: 'null', value: null },
        { id: 'false', value: false },
        { id: 'number', value: 0 },
        { id: 'string', value: 'a' },
      ]),
      outcome: ok([
        { id: 'string', value: 'a' },
        { id: 'number', value: 0 },
        { id: 'false', value: false },
        { id: 'null', value: null },
      ]),
    }),
    corpusCase({
      name: 'order-booleans-false-before-true',
      notes: 'Boolean order is false before true.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc' }] }),
      base: singleBase([{ id: 't', value: true }, { id: 'f', value: false }]),
      outcome: ok([{ id: 'f', value: false }, { id: 't', value: true }]),
    }),
    corpusCase({
      name: 'order-numbers-numeric',
      notes: 'Numbers compare numerically after canonical number normalization.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc' }] }),
      base: singleBase([{ id: 'p', value: 1.5 }, { id: 'n', value: -2 }, { id: 'z', value: 0 }]),
      outcome: ok([{ id: 'n', value: -2 }, { id: 'z', value: 0 }, { id: 'p', value: 1.5 }]),
    }),
    corpusCase({
      name: 'order-strings-unsigned-utf8',
      notes: 'String order is unsigned UTF-8 bytes, distinguishing it from JS UTF-16 order.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc' }] }),
      base: singleBase([
        { id: 'supplementary', value: '😀' },
        { id: 'private-use', value: '' },
        { id: 'ascii', value: 'a' },
      ]),
      outcome: ok([
        { id: 'ascii', value: 'a' },
        { id: 'private-use', value: '' },
        { id: 'supplementary', value: '😀' },
      ]),
    }),
    corpusCase({
      name: 'order-multiple-fields',
      notes: 'Order entries compare in sequence with independent directions.',
      transformPlan: plan({ order: [
        { field: 'group', direction: 'asc' },
        { field: 'rank', direction: 'desc' },
      ] }),
      base: singleBase([
        { id: 'a1', group: 'a', rank: 1 },
        { id: 'b2', group: 'b', rank: 2 },
        { id: 'a3', group: 'a', rank: 3 },
      ]),
      outcome: ok([
        { id: 'a3', group: 'a', rank: 3 },
        { id: 'a1', group: 'a', rank: 1 },
        { id: 'b2', group: 'b', rank: 2 },
      ]),
    }),
    corpusCase({
      name: 'order-stable-ties-preserve-base-order',
      notes: 'Comparator ties use the frozen stable tiebreak: assembled base order.',
      transformPlan: plan({ order: [{ field: 'tie', direction: 'asc' }] }),
      base: singleBase([
        { id: 'first', tie: 1 },
        { id: 'second', tie: 1 },
        { id: 'third', tie: 1 },
      ]),
      outcome: ok([
        { id: 'first', tie: 1 },
        { id: 'second', tie: 1 },
        { id: 'third', tie: 1 },
      ]),
    }),
    corpusCase({
      name: 'order-absent-field-is-null',
      notes: 'An absent projected order field reads as null and sorts before present scalars.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc' }] }),
      base: singleBase([{ id: 'present', value: 0 }, { id: 'missing' }]),
      outcome: ok([{ id: 'missing' }, { id: 'present', value: 0 }]),
    }),
    corpusCase({
      name: 'limit-zero',
      notes: 'limit 0 yields the empty result.',
      transformPlan: plan({ limit: 0 }),
      base: singleBase(limits),
      outcome: ok([]),
    }),
    corpusCase({
      name: 'limit-one',
      notes: 'limit 1 retains exactly the first row at the limit stage.',
      transformPlan: plan({ limit: 1 }),
      base: singleBase(limits),
      outcome: ok([limits[0]]),
    }),
    corpusCase({
      name: 'limit-exact-size',
      notes: 'A limit equal to result size preserves the complete result.',
      transformPlan: plan({ limit: 3 }),
      base: singleBase(limits),
      outcome: ok(limits),
    }),
    corpusCase({
      name: 'limit-over-size',
      notes: 'A limit larger than result size preserves the complete result.',
      transformPlan: plan({ limit: 10 }),
      base: singleBase(limits),
      outcome: ok(limits),
    }),
    corpusCase({
      name: 'pipeline-filter-before-order',
      notes: 'A row filtered out before ordering cannot trigger an order-field non-scalar refusal.',
      transformPlan: plan({
        filter: [{ field: 'active', op: 'eq', value: true }],
        order: [{ field: 'value', direction: 'asc' }],
      }),
      base: singleBase([
        { id: 'filtered', active: false, value: { nested: true } },
        { id: 'kept', active: true, value: 1 },
      ]),
      outcome: ok([{ id: 'kept', active: true, value: 1 }]),
    }),
    corpusCase({
      name: 'pipeline-composed-all-stages',
      notes: 'Page assembly, client overlay, filter, descending order, and limit compose in the fixed order.',
      transformPlan: plan({
        overlay: 'apply',
        filter: [{ field: 'active', op: 'eq', value: true }],
        order: [{ field: 'rank', direction: 'desc' }],
        limit: 2,
      }),
      base: chainBase([
        { version: 'stream-v7', terminal: false, rows: [
          { id: 'a', active: true, rank: 2 },
          { id: 'b', active: false, rank: 9 },
        ] },
        { version: 'stream-v7', terminal: true, rows: [
          { id: 'c', active: true, rank: 1 },
          { id: 'd', active: true, rank: 3 },
        ] },
      ]),
      clientOverlayRows: [
        { id: 'a', active: true, rank: 4 },
        { id: 'c', active: true, rank: 1 },
        { id: 'd', active: true, rank: 3 },
        { id: 'e', active: true, rank: 2 },
      ],
      outcome: ok([
        { id: 'a', active: true, rank: 4 },
        { id: 'd', active: true, rank: 3 },
      ]),
    }),
    corpusCase({
      name: 'refuse-unknown-stage',
      notes: 'An attempted stage vocabulary outside the closed record refuses.',
      transformPlan: { ...plan(), stages: ['project'] },
      outcome: refused(CODES.STAGE_UNKNOWN, 'unknown-stage'),
    }),
    corpusCase({
      name: 'refuse-unknown-comparator',
      notes: 'An order comparator selector is outside v1 because the comparator is frozen.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc', comparator: 'locale' }] }),
      outcome: refused(CODES.COMPARATOR_UNKNOWN, 'unknown-comparator'),
    }),
    corpusCase({
      name: 'refuse-normalization-attempt',
      notes: 'Cross-query or Unicode normalization remains explicitly unadmitted.',
      transformPlan: { ...plan(), normalization: 'canonical-rows-v1' },
      outcome: refused(CODES.NORMALIZATION_UNADMITTED, 'normalization-unadmitted'),
    }),
    corpusCase({
      name: 'refuse-unknown-plan-field',
      notes: 'Every TransformPlanV1 record is closed.',
      transformPlan: { ...plan(), project: ['id'] },
      outcome: refused(CODES.PLAN_INVALID, 'unknown-plan-field'),
    }),
    corpusCase({
      name: 'refuse-unknown-filter-grammar',
      notes: 'Only the basic-v1 filter grammar is admitted.',
      transformPlan: plan({ filterGrammar: 'locale-v1' }),
      outcome: refused(CODES.PLAN_INVALID, 'unknown-filter-grammar'),
    }),
    corpusCase({
      name: 'refuse-unknown-filter-operator',
      notes: 'Operators outside the closed basic-v1 set refuse.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'contains', value: 'x' }] }),
      outcome: refused(CODES.PLAN_INVALID, 'unknown-filter-operator'),
    }),
    corpusCase({
      name: 'refuse-empty-in-operand',
      notes: 'The in operand must be a nonempty array.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'in', value: [] }] }),
      outcome: refused(CODES.PLAN_INVALID, 'in-operand-not-nonempty-array'),
    }),
    corpusCase({
      name: 'refuse-duplicate-order-field',
      notes: 'Duplicate order fields refuse instead of creating ambiguous redundant order.',
      transformPlan: plan({ order: [
        { field: 'value', direction: 'asc' },
        { field: 'value', direction: 'desc' },
      ] }),
      outcome: refused(CODES.ORDER_FIELD_DUPLICATE, 'duplicate-order-field'),
    }),
    corpusCase({
      name: 'refuse-negative-limit',
      notes: 'A negative limit is outside the closed plan.',
      transformPlan: plan({ limit: -1 }),
      outcome: refused(CODES.LIMIT_INVALID, 'limit-not-nonnegative-safe-integer'),
    }),
    corpusCase({
      name: 'refuse-fractional-limit',
      notes: 'A fractional limit is outside the closed plan.',
      transformPlan: plan({ limit: 1.5 }),
      outcome: refused(CODES.LIMIT_INVALID, 'limit-not-nonnegative-safe-integer'),
    }),
    corpusCase({
      name: 'refuse-unsafe-limit',
      notes: 'A limit above the ECMAScript safe-integer ceiling refuses.',
      transformPlan: plan({ limit: 9007199254740992 }),
      outcome: refused(CODES.LIMIT_INVALID, 'limit-not-nonnegative-safe-integer'),
    }),
    corpusCase({
      name: 'refuse-cross-address-key',
      notes: 'A materialization key different from the executing address refuses.',
      transformPlan: plan({ materializationKey: 'qmk1.other-address' }),
      outcome: refused(CODES.CROSS_ADDRESS, 'cross-address-materialization-key'),
    }),
    corpusCase({
      name: 'refuse-unprojected-filter-field',
      notes: 'Filter fields must be declared by the projected result contract.',
      transformPlan: plan({ filter: [{ field: 'secret', op: 'eq', value: null }] }),
      outcome: refused(CODES.FIELD_UNPROJECTED, 'unprojected-filter-field'),
    }),
    corpusCase({
      name: 'refuse-unprojected-order-field',
      notes: 'Order fields must be declared by the projected result contract.',
      transformPlan: plan({ order: [{ field: 'secret', direction: 'asc' }] }),
      outcome: refused(CODES.FIELD_UNPROJECTED, 'unprojected-order-field'),
    }),
    corpusCase({
      name: 'refuse-non-scalar-filter-operand',
      notes: 'A non-in filter operand must be a canonical scalar.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'eq', value: { nested: true } }] }),
      outcome: refused(CODES.NON_SCALAR, 'non-scalar-filter-operand'),
    }),
    corpusCase({
      name: 'refuse-non-scalar-in-element',
      notes: 'The in array container is admitted but every element must be scalar.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'in', value: [1, { nested: true }] }] }),
      outcome: refused(CODES.NON_SCALAR, 'non-scalar-in-element'),
    }),
    corpusCase({
      name: 'refuse-non-scalar-filter-field',
      notes: 'A non-scalar row value in a filter field refuses execution.',
      transformPlan: plan({ filter: [{ field: 'value', op: 'eq', value: 1 }] }),
      base: singleBase([{ id: 'bad', value: [1] }]),
      outcome: refused(CODES.NON_SCALAR, 'non-scalar-filter-field'),
    }),
    corpusCase({
      name: 'refuse-non-scalar-order-field',
      notes: 'A non-scalar row value reaching the order stage refuses execution.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'asc' }] }),
      base: singleBase([{ id: 'bad', value: { nested: true } }]),
      outcome: refused(CODES.NON_SCALAR, 'non-scalar-order-field'),
    }),
    corpusCase({
      name: 'refuse-mixed-version-base',
      notes: 'Base assembly never crosses result versions.',
      base: chainBase([
        { version: 'stream-v7', terminal: false, rows: [{ id: 'a' }] },
        { version: 'stream-v8', terminal: true, rows: [{ id: 'b' }] },
      ]),
      outcome: refused(CODES.MIXED_VERSION, 'mixed-version-base'),
    }),
    corpusCase({
      name: 'refuse-broken-page-chain',
      notes: 'A complete page-set chain must have one terminal final page and no earlier terminal.',
      base: chainBase([
        { version: 'stream-v7', terminal: true, rows: [{ id: 'a' }] },
        { version: 'stream-v7', terminal: true, rows: [{ id: 'b' }] },
      ]),
      outcome: refused(CODES.BASE_INVALID, 'broken-page-chain'),
    }),
    corpusCase({
      name: 'refuse-non-row-sequence-contract',
      notes: 'V1 admits only established results whose contract shape is a row sequence.',
      base: singleBase([], { shape: 'scalar' }),
      outcome: refused(CODES.BASE_INVALID, 'non-row-sequence'),
    }),
    corpusCase({
      name: 'refuse-overlay-input-missing',
      notes: 'overlay apply requires client-materialized overlay rows; the server never synthesizes them.',
      transformPlan: plan({ overlay: 'apply' }),
      outcome: refused(CODES.OVERLAY_INPUT_REQUIRED, 'client-overlay-rows-required'),
    }),
    corpusCase({
      name: 'refuse-missing-plan-field',
      notes: 'Every required TransformPlanV1 field must be present.',
      transformPlan: (() => {
        const value = plan();
        delete value.limit;
        return value;
      })(),
      outcome: refused(CODES.PLAN_INVALID, 'missing-plan-field'),
    }),
    corpusCase({
      name: 'refuse-unknown-order-direction',
      notes: 'Only asc and desc directions are admitted.',
      transformPlan: plan({ order: [{ field: 'value', direction: 'sideways' }] }),
      outcome: refused(CODES.PLAN_INVALID, 'unknown-order-direction'),
    }),
    corpusCase({
      name: 'refuse-unknown-overlay-mode',
      notes: 'Only apply and none overlay modes are admitted.',
      transformPlan: plan({ overlay: 'merge' }),
      outcome: refused(CODES.PLAN_INVALID, 'unknown-overlay-mode'),
    }),
    corpusCase({
      name: 'refuse-empty-page-set',
      notes: 'Base assembly requires an established requested page or complete page chain.',
      base: chainBase([]),
      outcome: refused(CODES.BASE_INVALID, 'empty-page-set'),
    }),
    corpusCase({
      name: 'refuse-non-record-row',
      notes: 'The admitted result contract is a sequence of row records, not scalar entries.',
      base: singleBase([1]),
      outcome: refused(CODES.BASE_INVALID, 'row-not-record'),
    }),
  ];

  const names = new Set(cases.map(({ name }) => name));
  if (names.size !== cases.length) throw new Error('duplicate result-transform corpus case name');
  return cases;
}
