// @ref LLP 3000.030#4 — the bounded adapter refuses native inputs outside its inventories.
import fs from 'node:fs';
import path from 'node:path';
import { fail, hash } from './payload.mjs';

// Generated Expo 57.0.22 / CocoaPods 1.17 phases, with only the target name
// normalized. Custom scripts can read arbitrary undeclared inputs: refuse them.
const scripts = new Set([
  '49987658b902be328e98da33ba80b146e8dd84f15ed7afd45484b82fa0c00df8',
  'f27ea9d89e0c46c0d4633696a1334ef50d5a8c9584c538e9eebfb38b0b62e9a7',
  'b956bcf63913fac18538e698a6beb0e9afe582937cfdb22b59caaf3934d47251',
  '2c701f6e5faa1b7fc2fa723f966bc6095ba0ed0bba18b9d45e2b8e4eb0a54ab0',
  'd07c96b69633711210d8c0c9b5324aff1e80054d22318ee4a5850c3ba931ea59',
  '28943aec3652e14ca57708fd2862210a7694a9f94bfd88245ccf4f331cc835e1',
]);
const generated = new Set(['BUILT_PRODUCTS_DIR', 'PODS_CONFIGURATION_BUILD_DIR', 'PODS_XCFRAMEWORKS_BUILD_DIR', 'DERIVED_FILE_DIR']);
function reject(value) { fail('E_WITNESS_NATIVE_COMPAT', `native input outside covered roots or unsupported build input: ${value}; use manual preparation and installed-app mode`); }
export function nativeReferences(root, project, appName) {
  root = fs.realpathSync(root);
  const ios = path.join(root, 'ios'), objects = project.objects, parents = new Map(), visited = new Set();
  for (const [id, object] of Object.entries(objects)) for (const child of object.children ?? []) {
    if (parents.has(child)) reject(`ambiguous Xcode parent ${child}`);
    parents.set(child, id);
  }
  const variables = { SRCROOT: ios, PROJECT_DIR: ios, PODS_ROOT: path.join(ios, 'Pods'), PODS_PODFILE_DIR_PATH: ios,
    CONFIGURATION: 'Release', TARGET_NAME: appName, PRODUCT_NAME: appName };
  const inside = (p, base) => p === base || p.startsWith(base + path.sep);
  function input(value, base = ios) {
    if (typeof value !== 'string' || !value) reject(String(value));
    if (value === '/usr/lib/swift') return null; // Xcode's system Swift runtime search path
    const first = value.match(/^\$[({]([A-Z_]+)[)}](?:\/|$)/)?.[1];
    if (first && (generated.has(first) || first === 'SDKROOT')) {
      if (value.split('/').includes('..')) reject(value);
      return null; // system SDK or a generated build product, not a source input
    }
    const resolved = path.resolve(base, value.replace(/\$\((\w+)\)|\$\{(\w+)\}/g, (_, a, b) => variables[a ?? b] ?? reject(value)));
    if (resolved.includes('$')) reject(value);
    // Resolve even missing/generated leaves through their nearest existing parent.
    let ancestor = resolved;
    while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
    const canonical = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
    if (!inside(canonical, ios) && !inside(canonical, path.join(root, 'node_modules'))) reject(value);
    if (inside(canonical, path.join(ios, 'build')) || canonical.includes('/xcuserdata')) reject(value);
    if (inside(canonical, path.join(ios, 'Pods'))) {
      const pod = path.relative(path.join(ios, 'Pods'), canonical);
      const support = `Target Support Files/Pods-${appName}/`;
      const names = [`Pods-${appName}.debug.xcconfig`, `Pods-${appName}.release.xcconfig`,
        `Pods-${appName}-frameworks.sh`, `Pods-${appName}-resources.sh`, 'ExpoModulesProvider.swift', 'expo-configure-project.sh'];
      if (pod && pod !== 'Manifest.lock' && !(pod.startsWith(support) && names.includes(pod.slice(support.length)))) reject(value);
    }
    return canonical;
  }
  const locations = new Map();
  function locate(id, stack = new Set()) {
    if (locations.has(id)) return locations.get(id);
    if (stack.has(id)) reject(`Xcode group cycle ${id}`);
    stack.add(id);
    const obj = objects[id]; if (!obj) reject(`missing Xcode object ${id}`);
    const tree = obj.sourceTree ?? '<group>';
    let location;
    if (generated.has(tree) || tree === 'SDKROOT') {
      input(`$(${tree})/${obj.path ?? ''}`); location = null;
    } else if (tree === '<group>' || tree === 'SOURCE_ROOT' || tree === '<absolute>') {
      const parent = tree === '<group>' && parents.has(id) ? locate(parents.get(id), stack) : ios;
      if (!parent) reject(`source nested in build products ${id}`);
      location = input(obj.path ?? '.', parent);
    } else reject(`Xcode sourceTree ${tree}`);
    locations.set(id, location); return location;
  }
  function textInputs(file, kind = "") {
    // CocoaPods regenerates these from the locked closure in the private build.
    if (file && inside(file, path.join(ios, 'Pods'))) return;
    if (!file || visited.has(file + kind) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    visited.add(file + kind);
    if (kind === 'list' || file.toLowerCase().endsWith('.xcfilelist')) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))) input(line);
    } else if (kind === 'config' || file.toLowerCase().endsWith('.xcconfig')) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const include = line.match(/^\s*#include\??\s+"([^"]+)"/);
        if (include) textInputs(input(include[1], path.dirname(file)), 'config');
        const setting = line.match(/^\s*([A-Z_]+)(?:\[[^\]]+\])*\s*=\s*(.*)/);
        if (setting) settings({ [setting[1]]: setting[2].replace(/\s*\/\/.*$/, '') });
      }
    }
  }
  function settings(values) {
    for (const [rawKey, raw] of Object.entries(values)) {
      const key = rawKey.replace(/\[[^\]]+\]/g, '');
      if (/(?:BUILD_DIR|BUILD_ROOT|TEMP_DIR|TEMP_ROOT|CACHE_DIR|CACHE_ROOT|FOLDER_PATH|EXECUTABLE_PATH)$/.test(key)
        || /^(?:OBJECT_FILE_DIR(?:_.*)?|BUILT_PRODUCTS_DIR|INSTALL_DIR|DERIVED_DATA_PATH)$/.test(key)
        || ['SYMROOT', 'OBJROOT', 'DSTROOT', 'CCHROOT', 'SHARED_PRECOMPS_DIR', 'DERIVED_DATA_DIR', 'DERIVED_FILE_DIR', 'DERIVED_FILES_DIR', 'DERIVED_SOURCES_DIR', 'INDEX_DATA_STORE_DIR'].includes(key)) reject(`custom output ${key}: ${raw}`);
      // Flags can load response files, compiler plug-ins and undeclared inputs.
      // This adapter accepts only the generated template's flag vocabulary.
      if (/^(?:OTHER_.*FLAGS|COMPILER_FLAGS|GCC_PREPROCESSOR_DEFINITIONS)(?:\[|$)/.test(key)) {
        const allowed = new Set(['$(inherited)', '${inherited}', '-DRCT_REMOVE_LEGACY_ARCH=1', '-ObjC', '-lc++',
          '-D', 'EXPO_CONFIGURATION_DEBUG', 'EXPO_CONFIGURATION_RELEASE', 'DEBUG=1', 'FB_SONARKIT_ENABLED=1']);
        const tokens = (Array.isArray(raw) ? raw : [raw]).flatMap(v => String(v).split(/\s+/)).filter(Boolean);
        if (tokens.some(v => !allowed.has(v))) reject(`${key}: ${tokens.join(' ')}`);
      }
      if (/^(?:CC|CXX|LD|LDPLUSPLUS|SWIFT_EXEC|TOOLCHAINS|SDKROOT)(?:\[|$)/.test(key)
        && !(key === 'SDKROOT' && ['iphoneos', 'iphonesimulator'].includes(raw))) reject(`custom tool ${key}`);
      if (['PODFILE_DIR', 'REACT_NATIVE_PATH'].includes(key)) { input(raw); continue; }
      if (!/(?:SEARCH_PATHS|INCLUDE_PATHS|BRIDGING_HEADER|PREFIX_HEADER|MODULEMAP_FILE|INFOPLIST_FILE|ENTITLEMENTS)$/.test(key)) continue;
      for (const v of (Array.isArray(raw) ? raw : [raw])) {
        for (const token of String(v).match(/"[^"]*"|'[^']*'|\S+/g) ?? []) {
          const value = token.replace(/^["']|["']$/g, '');
          if (value === '$(inherited)' || value === '${inherited}') continue;
          input(value.replace(/\/\*\*$/, ''));
        }
      }
    }
  }
  for (const [id, object] of Object.entries(objects)) {
    if (object.projectDirPath || object.projectRoot || object.isa?.includes('SwiftPackage')
      || object.isa === 'PBXReferenceProxy') reject(`unsupported external project/package ${id}`);
    if (['PBXFileReference', 'PBXGroup', 'PBXVariantGroup'].includes(object.isa)) textInputs(locate(id));
    if (object.isa?.startsWith('PBXFileSystemSynchronized') || object.isa === 'PBXBuildRule') reject(object.isa);
    if (object.isa === 'PBXShellScriptBuildPhase' && (object.shellPath !== '/bin/sh'
      || !scripts.has(hash(object.shellScript.replaceAll(appName, '${APP_NAME}'))))) reject(`custom shell phase ${object.name ?? id}`);
    for (const ref of object.inputPaths ?? []) textInputs(input(ref));
    for (const ref of object.inputFileListPaths ?? []) textInputs(input(ref), 'list');
    if (object.baseConfigurationReference) textInputs(locate(object.baseConfigurationReference), 'config');
    if (object.buildSettings) settings(object.buildSettings);
    if (object.settings) settings(object.settings);
  }
  for (const [file, expected] of [
    ['Podfile', '0031e1bfe6ff10405d0bf963e85275d4693635eafe5ef62ad3d2d87e0a25bd6f'],
    ['.xcode.env', '3c02dca07775b31ce4e77dfb3bb660d7c6e577474d65a6216f1ea9bef54e1ca6'],
  ]) {
    const p = path.join(ios, file);
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf8').replace(`target '${appName}' do`, "target '${APP_NAME}' do");
      if (hash(text) !== expected) reject(`custom ${file}`);
    }
  }
  if (fs.existsSync(path.join(ios, '.xcode.env.updates'))) reject('.xcode.env.updates');
  for (const name of fs.readdirSync(ios).filter(n => n.endsWith('.xcworkspace'))) {
    const file = path.join(ios, name, 'contents.xcworkspacedata');
    if (fs.existsSync(file)) for (const match of fs.readFileSync(file, 'utf8').matchAll(/location\s*=\s*"([^"]+)"/g)) {
      if (![ `group:${appName}.xcodeproj`, 'group:Pods/Pods.xcodeproj' ].includes(match[1])) reject(match[1]);
    }
  }
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !['Pods', 'build', 'xcuserdata'].includes(entry.name)) scan(file);
      if (!entry.isFile()) continue;
      if (file.endsWith('.xcscheme') && /<ExecutionAction\b/.test(fs.readFileSync(file, 'utf8'))) reject('scheme execution action');
      if (/\.(?:h|hh|hpp|hxx|pch|c|cc|cpp|m|mm|metal)$/.test(file)) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\s*#\s*(?:include|import)\s+"([^"]+)"/gm)) input(match[1], path.dirname(file));
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\s*#\s*(?:include|import)\s+<((?:\/|\.\.\/)[^>]+)>/gm)) input(match[1], path.dirname(file));
      }
      if (entry.name.endsWith('.modulemap')) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/\b(?:header|umbrella)\s+"([^"]+)"/g)) input(match[1], path.dirname(file));
      }
      if (entry.name === 'Contents.json' && file.includes('.xcassets/')) {
        function assets(value) {
          if (!value || typeof value !== 'object') return;
          for (const [key, child] of Object.entries(value)) {
            if (key === 'filename') input(child, path.dirname(file)); else assets(child);
          }
        }
        assets(JSON.parse(fs.readFileSync(file, 'utf8')));
      }
    }
  }
  scan(ios);
  return { format: 1, coveredRoots: ['ios', 'node_modules'], references: [...locations.values()].filter(Boolean).map(p => path.relative(root, p)).sort() };
}
