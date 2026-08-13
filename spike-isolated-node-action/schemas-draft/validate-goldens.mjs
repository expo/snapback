import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from '../node_modules/ajv/dist/2020.js';

const root = dirname(fileURLToPath(import.meta.url));
const schemaNames = [
  'isolated-node-action-source-profile.v1',
  'isolated-node-action-dependency-closure.v1',
  'isolation-profile.v1',
  'egress-admission.v1',
  'action-attempt-receipt.v1',
  'isolated-action-diagnostics.v1',
];

export async function validateGoldens() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const cases = [];
  for (const name of schemaNames) {
    const schema = JSON.parse(readFileSync(join(root, `${name}.json`), 'utf8'));
    const validate = ajv.compile(schema);
    for (const expectation of ['valid', 'invalid']) {
      const instance = JSON.parse(readFileSync(join(root, 'goldens', `${name}.${expectation}.json`), 'utf8'));
      const accepted = validate(instance);
      const passed = expectation === 'valid' ? accepted : !accepted;
      cases.push({ name, expectation, passed, errors: validate.errors ?? [] });
    }
  }
  const vectorCorpus = JSON.parse(readFileSync(join(root, 'globally-routable-unicast-v1.vectors.json'), 'utf8'));
  const requiredVectorIds = [
    'ipv4-global', 'ipv4-metadata', 'ipv6-global', 'ipv4-mapped-global',
    'ipv4-translated-metadata', 'ipv6-scoped', 'ipv6-noncanonical', 'mixed-answer',
  ];
  const vectorCoveragePassed = requiredVectorIds.every((id) => vectorCorpus.vectors.some((vector) => vector.id === id));
  if (cases.some(({ passed }) => !passed) || !vectorCoveragePassed) {
    throw new Error(`draft schema validation failed: ${JSON.stringify({ cases, vectorCoveragePassed })}`);
  }
  return { passed: true, cases: cases.length, validCases: 6, invalidCases: 6, vectorCases: vectorCorpus.vectors.length, vectorCoveragePassed };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await validateGoldens(), null, 2));
}
