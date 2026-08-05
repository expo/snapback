import {
  deleteWhere,
  defineSchema,
  defineTable,
  defineVectorQuery,
  type InferValidator,
  v,
} from './define.js';

const vector3 = v.vector(3);
type Vector3 = InferValidator<typeof vector3>;
const exact: Vector3 = [1, 2, 3];
void exact;
// @ts-expect-error v.vector(D) retains exact D in the authored value type.
const tooShort: Vector3 = [1, 2];
void tooShort;

// @ts-expect-error deleteWhere requires an explicit filter; [] is clear-table.
deleteWhere('documents');

// @ts-expect-error search visibility must be an explicit author decision.
defineTable({ body: v.string() }).searchIndex('missing_visibility', {
  semanticVersion: 'missing-search-visibility.v1',
  textFields: { body: { weight: 1, classification: 'public' } },
});

export const documents = defineTable({
  embedding: vector3,
  category: v.optional(v.string()),
  title: v.string(),
}).vectorIndex('by_embedding', {
  semanticVersion: 'documents.embedding.v1',
  vectorField: 'embedding',
  metric: 'l2sq',
  fieldClassifications: {
    embedding: 'public',
    category: 'public',
    title: 'public',
  },
  equalityFilters: ['category'],
  storedFields: ['title'],
  visibility: { kind: 'public-read' },
  maxIndexedVectorsPerPartition: 128,
});
defineSchema({ documents });
defineVectorQuery({ table: documents, index: 'by_embedding' });

documents.vectorIndex('forged', {
  semanticVersion: 'forged.v1',
  vectorField: 'embedding',
  metric: 'dot',
  fieldClassifications: { embedding: 'public' },
  visibility: { kind: 'public-read' },
  maxIndexedVectorsPerPartition: 1,
  // @ts-expect-error maxScalarPairs is derived, not an authoring knob.
  maxScalarPairs: 3,
});

// @ts-expect-error vector visibility must be an explicit author decision.
documents.vectorIndex('missing_visibility', {
  semanticVersion: 'missing-visibility.v1',
  vectorField: 'embedding',
  metric: 'dot',
  fieldClassifications: { embedding: 'public' },
  maxIndexedVectorsPerPartition: 1,
});
