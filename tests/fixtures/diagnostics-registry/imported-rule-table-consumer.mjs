import { DYNAMIC_RULES, IMPORTED_RULES, ITERATED_RULES } from './imported-rule-table.mjs';

throw new Error(IMPORTED_RULES.direct.code);
throw new Error(IMPORTED_RULES['indexed'][0]);
throw new Error(IMPORTED_RULES.named);
for (const rule of ITERATED_RULES) {
  throw new Error(rule.code);
}
throw new Error(DYNAMIC_RULES[index]);
