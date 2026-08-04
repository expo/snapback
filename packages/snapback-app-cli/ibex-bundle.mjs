import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const namedBuiltinImport = /^import \{([^}]*)\} from "(node:[^"]+)";$/gmu;
const anyStaticBuiltinImport = /^import .* from "(node:[^"]+)";$/gmu;

export function normalizeIbexParentBundle(source) {
  const shebang = source.startsWith('#!') ? `${source.slice(0, source.indexOf('\n'))}\n` : '';
  const withoutShebang = shebang.length === 0 ? source : source.slice(shebang.length);
  const modules = new Map();
  const aliases = [];
  const body = withoutShebang.replace(namedBuiltinImport, (_statement, clause, specifier) => {
    let defaultLocal = modules.get(specifier);
    if (defaultLocal === undefined) {
      defaultLocal = `__ibexBuiltin${modules.size}`;
      modules.set(specifier, defaultLocal);
    }
    for (const rawMember of clause.split(',')) {
      const member = rawMember.trim();
      if (member.length === 0) continue;
      const match = /^(\S+)(?:\s+as\s+(\S+))?$/u.exec(member);
      if (match === null) throw new Error(`unsupported builtin import member '${member}'`);
      const [, imported, local = imported] = match;
      aliases.push(`const ${local} = ${defaultLocal}[${JSON.stringify(imported)}];`);
    }
    return '';
  });
  const unsupported = body.match(anyStaticBuiltinImport);
  if (unsupported !== null) {
    throw new Error(`unsupported static builtin import remains: ${unsupported[0]}`);
  }
  const imports = [...modules].map(
    ([specifier, defaultLocal]) => `import ${defaultLocal} from ${JSON.stringify(specifier)};`,
  );
  return `${shebang}${imports.join('\n')}\n${aliases.join('\n')}\n${body}`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path === undefined) throw new Error('usage: node ibex-bundle.mjs BUNDLE');
  const source = await readFile(path, 'utf8');
  await writeFile(path, normalizeIbexParentBundle(source), 'utf8');
}
