import { DYNAMIC_RULES, IMPORTED_RULES, ITERATED_RULES } from './imported-rule-table.mjs';

throw new Error(IMPORTED_RULES.direct.code);
throw new Error(IMPORTED_RULES['indexed'][0]);
throw new Error(IMPORTED_RULES.named);
for (const rule of ITERATED_RULES) {
  throw new Error(rule.code);
}
throw new Error(DYNAMIC_RULES[index]);

// Plain table reads are metadata/reference uses, not diagnostic emissions.
recordRule(IMPORTED_RULES.direct.code);
recordRule(IMPORTED_RULES['indexed'][0]);
recordRule(IMPORTED_RULES.named);
recordRule(DYNAMIC_RULES[index]);
