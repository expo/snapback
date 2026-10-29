const schemaBytes=readFileSync(new URL('./schema.json', import.meta.url));
const hashes=JSON.parse(readFileSync(new URL('./.generated-hashes.json', import.meta.url)));
assert.equal(createHash('sha256').update(schemaBytes).digest('hex'),hashes['$current-schema'],'E_PROOF_SCENARIO: schema.json was edited or is stale; save it, delete it and run check --proof-scaffold to refresh bound facts');
export const schema = JSON.parse(schemaBytes);
