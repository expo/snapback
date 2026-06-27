// Deliberately references a field that does not exist, to prove codegen fails
// closed with a structured diagnostic instead of silently dropping it.
import { asc, defineQuery, v } from '../../../../../_kit/define.mjs';

export const broken = defineQuery({
  table: 'todos',
  args: {},
  order: [asc('doesNotExist')], // <- unknown field
});
