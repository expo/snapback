import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const snapback = JSON.parse(
  readFileSync(join(root, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'),
);
const source = readFileSync(join(root, 'convex', 'incidents.ts'), 'utf8');
const sql = readFileSync(
  join(root, 'supabase', 'migrations', '202607270001_signal_desk.sql'),
  'utf8',
);
const required = [
  'createIncident',
  'addTask',
  'toggleTask',
  'addComment',
  'setStatus',
  'searchIncidents',
  'generateBrief',
];
const snapbackNames = new Set(snapback.functions.map((fn) => fn.name));
for (const name of required) {
  if (!snapbackNames.has(name)) throw new Error(`Snapback is missing ${name}`);
}
for (const name of ['create', 'addTask', 'toggleTask', 'addComment', 'setStatus', 'search', 'brief']) {
  if (!source.includes(`export const ${name}`)) throw new Error(`Convex is missing ${name}`);
}
for (const name of [
  'bakeoff_create_incident',
  'bakeoff_add_task',
  'bakeoff_toggle_task',
  'bakeoff_add_comment',
  'bakeoff_set_status',
  'bakeoff_generate_brief',
]) {
  if (!sql.includes(`function public.${name}`)) throw new Error(`Supabase is missing ${name}`);
}
process.stdout.write('Three-backend product contract inventory — pass\n');
