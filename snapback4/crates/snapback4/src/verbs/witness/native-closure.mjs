// @ref LLP 3000.030#3 — private build outputs and recorded native inputs, never repack eligibility.
import fs from 'node:fs';
import path from 'node:path';
import { hash, fail } from './payload.mjs';
import { phaseHashes, supportHashes } from './native-scripts.mjs';
const inside = (p, root) => p === root || p.startsWith(root + path.sep);
const refuse = value => fail('E_WITNESS_NATIVE_COMPAT', `${value}; use witness ios --build (or manual installed-app mode for unsupported inputs)`);
export function canonical(file) {
  let parent = path.resolve(file);
  while (!fs.existsSync(parent) && parent !== path.dirname(parent)) parent = path.dirname(parent);
  return path.resolve(fs.realpathSync(parent), path.relative(parent, file));
}
// Deliberately no shell evaluation. Unknown substitutions/quoting fail closed.
export function words(text) {
  const result = []; let word = '', quote = '', escaped = false, active = false;
  for (const ch of String(text)) {
    if (escaped) { word += ch; escaped = false; active = true; }
    else if (ch === '\\') escaped = true;
    else if (quote) { if (ch === quote) quote = ''; else word += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; active = true; }
    else if (/\s/.test(ch)) { if (active) result.push(word); word = ''; active = false; }
    else { word += ch; active = true; }
  }
  if (escaped || quote) refuse(`unresolved native token ${text}`);
  if (active) result.push(word);
  return result;
}
export function privateBuildFlags(cache) {
  const d = path.join(cache, 'DerivedData');
  return Object.entries({ GCC_GENERATE_DEPENDENCIES: 'YES', SYMROOT: `${d}/Build/Products`, OBJROOT: `${d}/Build/Intermediates.noindex`,
    DSTROOT: `${d}/Install`, SHARED_PRECOMPS_DIR: `${d}/PrecompiledHeaders`, CACHE_ROOT: `${d}/Cache`,
    CCHROOT: `${d}/Cache`, CLANG_MODULE_CACHE_PATH: `${d}/ModuleCache.noindex`,
    SWIFT_MODULE_CACHE_PATH: `${d}/ModuleCache.noindex`, SDK_STAT_CACHE_DIR: d,
    INDEX_DATA_STORE_DIR: `${d}/Index.noindex/DataStore` }).map(([k, v]) => `${k}=${v}`);
}
// Xcode 27 Ld.xcspec: map, dependency info, LTO and SDK-import side outputs
// bypass SYMROOT/OBJROOT when explicitly set. Install-name and runtime search
// settings are metadata, not file destinations. Unknown linker flags refuse.
export const linkerOutputKey = key => ['LD_MAP_FILE_PATH', 'LD_DEPENDENCY_INFO_FILE', 'LD_LTO_OBJECT_FILE', 'LD_SDK_IMPORTS_FILE'].includes(key);
const outputKey = key => linkerOutputKey(key) || /^(?:OBJECT_FILE_DIR(?:_.*)?|BUILT_PRODUCTS_DIR|DWARF_DSYM_FOLDER_PATH|INSTALL_DIR|DERIVED_DATA_PATH)$/.test(key) || /(?:BUILD_DIR|BUILD_ROOT|TEMP_DIR|TEMP_ROOT|CACHE_DIR|CACHE_ROOT)$/.test(key)
  || ['SYMROOT', 'OBJROOT', 'DSTROOT', 'CCHROOT', 'SHARED_PRECOMPS_DIR', 'DERIVED_DATA_DIR', 'DERIVED_FILE_DIR', 'DERIVED_FILES_DIR', 'DERIVED_SOURCES_DIR', 'INDEX_DATA_STORE_DIR', 'CLANG_MODULE_CACHE_PATH', 'SWIFT_MODULE_CACHE_PATH', 'INSTALL_ROOT', 'TARGET_BUILD_DIR'].includes(key);
export function validateOutputs(rows, cache) {
  if (!Array.isArray(rows) || !rows.length) refuse('missing resolved target settings');
  const owned = canonical(cache);
  for (const { target, buildSettings: s } of rows) {
    for (const required of ['TARGET_BUILD_DIR', 'TARGET_TEMP_DIR', 'OBJROOT', 'SYMROOT']) if (!s?.[required]) refuse(`${target}: missing ${required}`);
    for (const [key, value] of Object.entries(s)) if (outputKey(key) && value) {
      if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('$') || !inside(canonical(value), owned))
        refuse(`${target}: output ${key} escapes private workspace: ${value}`);
    }
    for (const [key, value] of Object.entries(s)) if (/(?:FOLDER_PATH|EXECUTABLE_PATH)$/.test(key) && value) {
      if (!s.WRAPPER_NAME && ['PRIVATE_HEADERS_FOLDER_PATH', 'PUBLIC_HEADERS_FOLDER_PATH'].includes(key) && value === '/usr/local/include') continue;
      if (key === 'XPCSERVICES_FOLDER_PATH' && value === '/XPCServices' && !s.WRAPPER_NAME) continue;
      if (value.includes('$') || !inside(canonical(path.resolve(s.TARGET_BUILD_DIR, value)), owned)) refuse(`${target}: output ${key} escapes private workspace: ${value}`);
    }
    if (s.FULL_PRODUCT_NAME && (s.FULL_PRODUCT_NAME !== path.basename(s.FULL_PRODUCT_NAME) || s.FULL_PRODUCT_NAME === '..')) refuse(`${target}: invalid FULL_PRODUCT_NAME`);
  }
}
export function closureResolver(root, cache, systemRoots) {
  root = canonical(root); cache = canonical(cache);
  const roots = [path.join(root, 'ios'), path.join(root, 'node_modules')];
  const systems = systemRoots.map(canonical), derived = path.join(cache, 'DerivedData');
  return (raw, base = path.join(root, 'ios')) => {
    if (!raw || /[\0\n$]/.test(raw)) refuse(`unresolved native input: ${raw}`);
    const p = canonical(path.resolve(base, raw.replace(/\/\*\*$/, '')));
    if (systems.some(r => inside(p, r))) return { path: p, kind: 'toolchain' };
    if (inside(p, derived)) return { path: p, kind: 'generated' };
    if (roots.some(r => inside(p, r)) && !p.includes('/xcuserdata')
      && (!inside(p, path.join(root, 'ios/build')) || inside(p, path.join(root, 'ios/build/generated')))) return { path: p, kind: 'input' };
    refuse(`native input outside covered roots: ${raw} -> ${p}`);
  };
}
function expand(value, settings) {
  let previous;
  for (let n = 0; n < 12 && previous !== value; n++) {
    previous = value;
    value = value.replace(/\$\((\w+)\)|\$\{(\w+)\}|\$(\w+)/g, (_, a, b, c) => settings[a ?? b ?? c] ?? refuse(`unknown native variable ${a ?? b ?? c}`));
  }
  if (value.includes('$')) refuse(`unresolved native setting ${value}`);
  return value;
}
export function auditNativeProject(project, projectDir, rows, root, cache, systemRoots, appName) {
  validateOutputs(rows, cache);
  const resolve = closureResolver(root, cache, systemRoots), objects = project.objects;
  const parents = new Map(), sources = new Set(), products = new Set(), references = new Set(), phases = [];
  for (const [id, o] of Object.entries(objects)) for (const child of o.children ?? []) {
    if (parents.has(child)) refuse(`ambiguous native group ${child}`); parents.set(child, id);
  }
  const normalize = value => value.replaceAll(root, '${PROJECT}').replaceAll(appName, '${APP_NAME}');
  function check(raw, s, base = projectDir) {
    const item = resolve(expand(raw, s), base); references.add(item.path); return item.path;
  }
  function locate(id, s, seen = new Set()) {
    if (seen.has(id) || !objects[id]) refuse(`unresolved native reference ${id}`); seen.add(id);
    const o = objects[id], tree = o.sourceTree ?? '<group>';
    let base;
    if (tree === '<group>') base = parents.has(id) ? locate(parents.get(id), s, seen) : projectDir;
    else if (tree === 'SOURCE_ROOT') base = projectDir;
    else if (tree === '<absolute>') base = '/';
    else if (s[tree]) base = s[tree];
    else refuse(`unknown native sourceTree ${tree}`);
    return check(o.path ?? '.', s, base);
  }
  const checkedText = new Set();
  function textInputs(file, s, kind = '') {
    if (checkedText.has(file + s.TARGET_NAME + kind)) return;
    checkedText.add(file + s.TARGET_NAME + kind);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) refuse(`missing native input ${file}`);
    const text = fs.readFileSync(file, 'utf8');
    if (kind === 'config') {
      // Strip comments before recognizing directives; no unparsed directive is ignored.
      const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\\r?\n/g, '');
      for (const line of clean.split('\n')) if (/^\s*#/.test(line)) {
        const match = line.match(/^\s*#\s*include\??\s+"([^"]+)"\s*(?:\/\/.*)?$/);
        if (!match) refuse(`unknown xcconfig directive: ${file}: ${line}`);
        textInputs(check(match[1], s, path.dirname(file)), s, 'config');
      }
    } else if (kind === 'list') {
      for (const line of text.split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#'))) check(line, s);
    }
  }
  function flags(value, s) {
    const tokens = words(expand(Array.isArray(value) ? value.join(' ') : value, s));
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '-x') { if (!['objective-c', 'objective-c++', 'c', 'c++'].includes(tokens[++i])) refuse(`unsupported source language ${value}`); continue; }
      if (['-Xcc', '-Xfrontend', '-D'].includes(t)) { if (t === '-D' && !/^[A-Z_][A-Z_0-9]*$/.test(tokens[++i] ?? '')) refuse(`unsupported native flag ${value}`); continue; }
      if (['-ivfsoverlay', '-include', '-imacros', '-I', '-F', '-L', '-isystem', '-iquote', '-iframework'].includes(t)) {
        const file = check(tokens[++i], s);
        if (t === '-ivfsoverlay') {
          const text = fs.readFileSync(file, 'utf8');
          for (const line of text.split('\n').filter(x => x.trim())) {
            const m = line.match(/^\s*(?:- )?(name|type|external-contents): '([^'\\]*)'\s*$/);
            if (m) { if (m[1] === 'external-contents' || (m[1] === 'name' && path.isAbsolute(m[2]))) check(m[2], s, path.dirname(file)); }
            else if (!/^\s*(?:version: 0|case-sensitive: false|roots:|contents:)\s*$/.test(line)) refuse(`unsupported VFS overlay ${file}: ${line}`);
          }
        }
        continue;
      }
      if (t.startsWith('-fmodule-map-file=')) { check(t.slice(18), s); continue; }
      if (/^-[IFL].+/.test(t)) { check(t.slice(2), s); continue; }
      if (t === '-load-plugin-executable') {
        const plugin = check(tokens[++i].split('#')[0], s);
        if (plugin !== path.join(root, 'node_modules/@expo/expo-modules-macros-plugin/apple/ExpoModulesMacros-tool')) refuse(`unsupported compiler plugin ${plugin}`);
        continue;
      }
      if (['-framework', '-weak_framework'].includes(t)) { if (!/^[\w+.-]+$/.test(tokens[++i] ?? '')) refuse(`unsupported framework ${value}`); continue; }
      if (/^-D[A-Z_][\w]*(?:=[^/\\]*)?$/.test(t) || /^-W[\w,=+-]+$/.test(t) || /^-l[\w+.-]+$/.test(t)
        || ['-std=c++20', '-ObjC', '-import-underlying-module', '-fcxx-modules', '-fmodules', '-fno-objc-arc', '-fobjc-arc', '-fno-common', '-fno-exceptions'].includes(t)) continue;
      refuse(`unsupported native flag ${t}`);
    }
  }
  for (const [id, object] of Object.entries(objects)) {
    if (object.projectDirPath || object.projectRoot || object.isa?.includes('SwiftPackage') || ['PBXBuildRule', 'PBXReferenceProxy'].includes(object.isa) || object.isa?.startsWith('PBXFileSystemSynchronized')) refuse(`unsupported native graph object ${id}`);
  }
  for (const row of rows) {
    const s = { ...row.buildSettings, inherited: '', TARGET_NAME: row.target };
    for (const [key, value] of Object.entries(s)) {
      if (['CC', 'CXX', 'LD', 'LDPLUSPLUS', 'SWIFT_EXEC', 'SDKROOT'].includes(key) && value
        && !['clang', 'clang++', 'ld', 'swiftc'].includes(value)) {
        if (resolve(value).kind !== 'toolchain') refuse(`unsupported native tool ${key}: ${value}`);
      }
      if (/(?:SEARCH_PATHS|INCLUDE_PATHS|BRIDGING_HEADER|PREFIX_HEADER|MODULEMAP_FILE|INFOPLIST_FILE|ENTITLEMENTS)$/.test(key) && value) {
        if (key === 'LD_RUNPATH_SEARCH_PATHS') continue; // Runtime lookup, never an input to this build.
        // Single-file settings may contain spaces without shell quoting.
        const paths = key.endsWith('_PATHS') ? words(value) : [value];
        for (const p of paths) { if (p !== '/usr/lib/swift') check(p, s); }
      }
      if (/^(OTHER_(?:C|CPLUSPLUS|SWIFT|LD|LIBTOOL|MODULE_VERIFIER)FLAGS|WARNING_CFLAGS)$/.test(key) && value) flags(value, s);
      if (['PODS_TARGET_SRCROOT', 'PODFILE_DIR', 'REACT_NATIVE_PATH', 'SRCROOT', 'PROJECT_DIR'].includes(key) && value) check(value, s);
    }
    // Inspect every target's phases and inherited configuration files, including Pods.
    const targets = Object.values(objects).filter(o => ['PBXNativeTarget', 'PBXAggregateTarget'].includes(o.isa) && o.name === row.target);
    if (targets.length !== 1) refuse(`missing native target graph ${row.target}`);
    const target = targets[0];
    for (const owner of [target, objects[project.rootObject]]) {
      const list = objects[owner?.buildConfigurationList];
      for (const id of list?.buildConfigurations ?? []) {
        const cfg = objects[id]; if (cfg.name !== 'Release') continue;
        if (cfg.baseConfigurationReference) textInputs(locate(cfg.baseConfigurationReference, s), s, 'config');
      }
    }
    let hasSources = false;
    for (const id of target.buildPhases ?? []) {
      const phase = objects[id]; if (!phase) refuse(`missing phase ${id}`);
      if (phase.isa === 'PBXShellScriptBuildPhase') {
        const digest = hash(normalize(phase.shellScript));
        if (!['/bin/sh', '/bin/bash'].includes(phase.shellPath) || !phaseHashes.has(digest)) refuse(`unsupported native script ${row.target}: ${phase.name ?? id}`);
        phases.push({ target: row.target, name: phase.name, sha256: digest });
      // Copy phases have a separate destination-base selector (including an
      // absolute destination with empty dstPath). None are qualified here.
      } else if (!['PBXSourcesBuildPhase', 'PBXResourcesBuildPhase', 'PBXFrameworksBuildPhase', 'PBXHeadersBuildPhase'].includes(phase.isa)) refuse(`unknown native phase ${phase.isa}`);
      for (const ref of phase.inputPaths ?? []) check(ref, s);
      for (const ref of phase.inputFileListPaths ?? []) textInputs(check(ref, s), s, 'list');
      for (const ref of phase.outputPaths ?? []) {
        const p = check(ref, s); if (!inside(p, canonical(cache))) refuse(`script output outside private workspace: ${p}`);
      }
      for (const ref of phase.outputFileListPaths ?? []) textInputs(check(ref, s), s, 'list');
      for (const id of phase.files ?? []) {
        const bf = objects[id], file = locate(bf.fileRef, s);
        if (phase.isa === 'PBXSourcesBuildPhase') {
          if (!/\.(?:c|cc|cpp|cxx|m|mm|swift)$/.test(file)) refuse(`unsupported compilation input ${file}`);
          sources.add(file); hasSources = true;
        }
        if (phase.isa === 'PBXResourcesBuildPhase' && file.endsWith('.xcassets')) {
          const assets = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name); if (e.isDirectory()) assets(p);
            else if (e.name === 'Contents.json') {
              const walk = v => { if (!v || typeof v !== 'object') return; for (const [k, x] of Object.entries(v)) { if (k === 'filename') check(x, s, dir); else walk(x); } };
              walk(JSON.parse(fs.readFileSync(p, 'utf8')));
            }
          } }; assets(file);
        }
        if (bf.settings?.COMPILER_FLAGS) flags(bf.settings.COMPILER_FLAGS, s);
      }
    }
    if (hasSources) {
      if (!s.EXECUTABLE_PATH) refuse(`missing linked product ${row.target}`);
      products.add(check(s.EXECUTABLE_PATH, s, s.TARGET_BUILD_DIR));
    }
  }
  // CocoaPods-generated shell implementations are executable build inputs too.
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.sh')) {
      const digest = hash(normalize(fs.readFileSync(file, 'utf8')));
      if (!supportHashes.has(digest)) refuse(`unsupported native script implementation ${file}`);
    }
  } };
  const support = path.join(root, 'ios/Pods/Target Support Files'); if (fs.existsSync(support)) walk(support);
  return { sources: [...sources].sort(), products: [...products].sort(), references: [...references].sort(), phases };
}
// Clang and Swift emit Make-style dependencies. Support escaped whitespace,
// backslashes and continuations; reject unsupported Make constructs.
export function dependencies(text) {
  const result = [];
  for (const line of text.replace(/\\\r?\n/g, '').split(/\r?\n/).filter(x => x.trim())) {
    const colon = line.search(/(?<!\\):/); if (colon < 0 || /(?<!\\)[#$]/.test(line)) refuse('unrecognized compiler dependency record');
    const tail = line.slice(colon + 1);
    // Quotes are literal in Make paths, unlike build settings.
    let token = '', escape = false;
    for (const ch of tail + ' ') {
      if (escape) { token += ch; escape = false; }
      else if (ch === '\\') escape = true;
      else if (/\s/.test(ch)) { if (token) result.push(token); token = ''; }
      else token += ch;
    }
    if (escape) refuse('truncated compiler dependency record');
  }
  return result;
}
export function compilerClosure(root, cache, systemRoots, sources, products = []) {
  if (!sources.length) refuse('missing compiler source coverage');
  const resolve = closureResolver(root, cache, systemRoots), records = [], seen = new Set(), linked = new Set(), sdkNames = new Set(), inputs = new Map();
  const dir = path.join(cache, 'DerivedData/Build/Intermediates.noindex');
  const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('_dependency_info.dat')) {
      const bytes = fs.readFileSync(file); records.push({ path: path.relative(cache, file), sha256: hash(bytes), kind: 'linker' });
      for (let offset = 0; offset < bytes.length;) {
        const tag = bytes[offset], end = bytes.indexOf(0, offset + 1);
        if (end < 0 || ![0, 0x10, 0x11, 0x40].includes(tag)) refuse(`unknown linker dependency format ${file}`);
        const name = bytes.subarray(offset + 1, end).toString('utf8'); offset = end + 1;
        if (tag === 0) continue;
        const item = resolve(name);
        if (tag === 0x40) { linked.add(item.path); continue; }
        if (tag === 0x11) {
          if (!inputs.has(item.path)) inputs.set(item.path, { ...item, missing: true });
        } else {
          if (!fs.existsSync(item.path) && item.kind === 'toolchain' && /^(?:\/System\/Library\/|\/usr\/lib\/)/.test(name)) { sdkNames.add(name); continue; }
          if (!fs.existsSync(item.path) || !fs.statSync(item.path).isFile()) refuse(`missing linker input ${name}`);
          inputs.set(item.path, { ...item, sha256: hash(fs.readFileSync(item.path)) });
        }
      }
    }
    else if (entry.name.endsWith('.d')) {
      const text = fs.readFileSync(file, 'utf8'), deps = dependencies(text);
      if (!deps.length) refuse(`empty compiler dependencies ${file}`);
      records.push({ path: path.relative(cache, file), sha256: hash(text) });
      for (const dep of deps) {
        if (!path.isAbsolute(dep)) refuse(`relative compiler dependency ${file}: ${dep}`);
        const item = resolve(dep); seen.add(item.path);
        if (!inputs.has(item.path)) {
          if (!fs.existsSync(item.path) || !fs.statSync(item.path).isFile()) refuse(`missing compiler input ${dep}`);
          inputs.set(item.path, { ...item, sha256: hash(fs.readFileSync(item.path)) });
        }
      }
    }
  } };
  if (!fs.existsSync(dir)) refuse('missing compiler dependency coverage'); walk(dir);
  const definitions = new Map();
  for (const input of inputs.values()) if (input.kind === 'toolchain' && input.path.endsWith('.tbd') && input.sha256) {
    for (const m of fs.readFileSync(input.path, 'utf8').matchAll(/^install-name:\s*'?([^'\r\n]+)'?\s*$/gm)) definitions.set(m[1].trim(), input.path);
  }
  const sdkInstallNames = [...sdkNames].sort().map(name => {
    if (!definitions.has(name)) refuse(`missing SDK definition for linker install-name ${name}`);
    return { name, definition: definitions.get(name) };
  });
  for (const source of sources) if (!seen.has(canonical(source))) refuse(`missing compiler dependency coverage for ${source}`);
  for (const product of products) if (!linked.has(canonical(product))) refuse(`missing linker dependency coverage for ${product}`);
  if (!records.length) refuse('missing compiler dependency records');
  return { format: 1, sources, products, sdkInstallNames, records: records.sort((a, b) => a.path.localeCompare(b.path)), inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
