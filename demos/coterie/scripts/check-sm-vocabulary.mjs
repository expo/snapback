#!/usr/bin/env node

// Misuse-only static guard for the frozen social-messenger IDs in
// benchmarks/tools/social-messenger/CONTRACT.md. The authority stays open to
// extras, so IDs absent from that file are reported but never rejected.
// @ref LLP 0266#d10-acceptance-harness-direction-for-oq2 — Coterie imports
// the shared semantic-ID authority instead of forking a private vocabulary.
//
// Statically enforced authority rules:
// - every sm-trending-row composes the existing FeedCard/sm-feed-item surface;
// - chat color and disappearing options expose values and selected state, and
//   literal disappearing values stay in the pinned off/24h/7d value space;
// - chooser IDs reject non-interactive elements and structurally contradictory
//   selection/navigation controls; real file inputs and labels linked to them
//   are positively identified without interpreting handler names;
// - media/background-preview IDs contain a real image/video node;
// - the explicitly named message actions, reaction choices, quote preview,
//   and view-once toggle label interactive controls.
//
// Structural rules bind IDs to Contract element lines and parsed JSX/TSX
// opening elements. Other source extensions are inventoried for vocabulary
// drift, but their literals are not structurally interpreted.
//
// Deliberately out of static reach: runtime choreography; route visibility;
// async/empty-state exclusivity; repeated-row counts; whether sm-profile's
// dynamic values visibly equal the current display name and bio; whether a
// background preview actually changes after selection; media load success;
// consumed/denied view-once state; and semantics hidden behind a dynamic
// testId or an opaque component. A neutral interactive trigger whose only
// chooser evidence is what its handler does is also runtime-only: handler names
// are not evidence either way. Those cases need the shared choreography/host
// tree.

import {
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const DEFAULT_AUTHORITY = resolve(
  REPO_ROOT,
  'benchmarks/tools/social-messenger/CONTRACT.md',
);
const SOURCE_EXTENSIONS = new Set([
  '.contract',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const SM_ID_PATTERN = /\bsm-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;
const DISAPPEARING_VALUES = new Set(['off', '24h', '7d']);
const INTERACTIVE_ACTION_IDS = new Set([
  'sm-convo-delete',
  'sm-convo-edit',
  'sm-convo-quote',
  'sm-convo-quote-preview',
  'sm-convo-react',
  'sm-convo-reaction',
  'sm-convo-viewonce-toggle',
]);

function compareCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractFrozenSmIds(authoritySource) {
  const start = authoritySource.indexOf('## Test IDs');
  const end = authoritySource.indexOf('## Versioning', start);
  if (start < 0 || end < 0) {
    throw new Error('social-messenger authority is missing its Test IDs section');
  }
  const frozenIds = new Set();
  for (const codeSpan of authoritySource.slice(start, end).matchAll(/`([^`\n]+)`/g)) {
    const token = codeSpan[1] ?? '';
    if (/[*?<>]/.test(token)) continue;
    for (const match of token.matchAll(SM_ID_PATTERN)) frozenIds.add(match[0]);
  }
  return new Set([...frozenIds].sort(compareCodeUnit));
}

function collectSourceFiles(inputPaths) {
  const files = [];
  const visit = (filePath) => {
    const info = statSync(filePath);
    if (info.isDirectory()) {
      for (const entry of readdirSync(filePath).sort(compareCodeUnit)) {
        if (entry === 'dist' || entry === 'node_modules') continue;
        visit(resolve(filePath, entry));
      }
      return;
    }
    if (info.isFile() && SOURCE_EXTENSIONS.has(extname(filePath))) files.push(filePath);
  };
  for (const inputPath of [...inputPaths].sort(compareCodeUnit)) visit(resolve(inputPath));
  return files.sort(compareCodeUnit);
}

function indentation(line) {
  const prefix = line.match(/^[ \t]*/)?.[0] ?? '';
  return [...prefix].reduce((width, character) => width + (character === '\t' ? 2 : 1), 0);
}

function sourceLines(source) {
  const records = [];
  let start = 0;
  while (start <= source.length) {
    const newline = source.indexOf('\n', start);
    const rawEnd = newline < 0 ? source.length : newline;
    const end = rawEnd > start && source[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    records.push({ line: source.slice(start, end), offset: start });
    if (newline < 0) break;
    start = newline + 1;
  }
  return records;
}

function stripContractComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '/' && line[index + 1] === '/') return line.slice(0, index);
  }
  return line;
}

function isContractAssertion(line) {
  return /^\s*(?:when\b.+\bthen\s+)?has\s+(?:node|input|button|text|link)\b/.test(line);
}

function hasLiteralTestId(line, id) {
  const quotedId = `["'\`]${escapeRegExp(id)}["'\`]`;
  return new RegExp(
    `(?:testId|testID|data-testid|dataTestId|accessibilityLabel)\\s*=\\s*(?:\\{\\s*)?${quotedId}`,
  ).test(line);
}

function jsxAttributeName(attribute) {
  return attribute.name.getText();
}

function jsxLiteralAttributeValue(attribute) {
  const initializer = attribute.initializer;
  if (!initializer) return '';
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return null;
  if (ts.isStringLiteral(initializer.expression)
    || ts.isNoSubstitutionTemplateLiteral(initializer.expression)) {
    return initializer.expression.text;
  }
  return null;
}

function collectJsxElements(source, filePath) {
  const extension = extname(filePath);
  const scriptKind = extension === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const elements = [];

  function visit(node) {
    let opening = null;
    let fullNode = null;
    if (ts.isJsxElement(node)) {
      opening = node.openingElement;
      fullNode = node;
    } else if (ts.isJsxSelfClosingElement(node)) {
      opening = node;
      fullNode = node;
    }
    if (opening && fullNode) {
      const attributes = new Map();
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        attributes.set(jsxAttributeName(attribute), jsxLiteralAttributeValue(attribute));
      }
      elements.push({
        kind: 'jsx',
        name: opening.tagName.getText(sourceFile),
        openingSource: source.slice(opening.getStart(sourceFile), opening.end),
        openingStart: opening.getStart(sourceFile),
        openingEnd: opening.end,
        fullEnd: fullNode.end,
        attributes,
        descendants: [],
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const element of elements) {
    element.descendants = elements.filter((candidate) =>
      candidate.openingStart > element.openingStart
      && candidate.fullEnd <= element.fullEnd);
  }
  return elements;
}

function collectContractElements(source) {
  const records = sourceLines(source);
  const lines = records.map((record) => record.line);

  const elements = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex] ?? '';
    const openingSource = stripContractComment(rawLine);
    if (openingSource.trim() === '' || isContractAssertion(openingSource)) continue;
    const name = openingSource.trim().match(/^([A-Za-z][A-Za-z0-9_.-]*)\b/)?.[1] ?? null;
    if (!name) continue;
    const rootIndent = indentation(rawLine);
    let lastLineIndex = lineIndex;
    for (let candidate = lineIndex + 1; candidate < lines.length; candidate += 1) {
      const candidateLine = lines[candidate] ?? '';
      if (candidateLine.trim() === '') continue;
      if (indentation(candidateLine) <= rootIndent) break;
      lastLineIndex = candidate;
    }
    elements.push({
      kind: 'contract',
      name,
      openingSource,
      openingStart: records[lineIndex].offset,
      openingEnd: records[lineIndex].offset + rawLine.length,
      fullEnd: records[lastLineIndex].offset + (lines[lastLineIndex]?.length ?? 0),
      attributes: null,
      descendants: [],
    });
  }

  for (const element of elements) {
    element.descendants = elements.filter((candidate) =>
      candidate.openingStart > element.openingStart
      && candidate.fullEnd <= element.fullEnd);
  }
  return elements;
}

function collectSemanticElements(source, filePath) {
  const extension = extname(filePath);
  if (extension === '.contract') return collectContractElements(source);
  if (extension === '.jsx' || extension === '.tsx') return collectJsxElements(source, filePath);
  return [];
}

function literalAttributeValue(element, names) {
  if (element.kind === 'jsx') {
    for (const name of names) {
      const value = element.attributes.get(name);
      if (typeof value === 'string') return value;
    }
    return null;
  }
  const values = literalAttributeValues(element.openingSource, names);
  return values[0] ?? null;
}

function elementHasLiteralTestId(element, id) {
  if (element.kind === 'jsx') {
    return [
      'testId',
      'testID',
      'data-testid',
      'dataTestId',
      'accessibilityLabel',
    ].some((name) => element.attributes.get(name) === id);
  }
  return hasLiteralTestId(element.openingSource, id);
}

function semanticElementForUse(elements, use) {
  return elements
    .filter((element) =>
      element.openingStart <= use.offset
      && use.offset < element.openingEnd
      && elementHasLiteralTestId(element, use.id))
    .sort((left, right) =>
      (left.openingEnd - left.openingStart) - (right.openingEnd - right.openingStart))[0] ?? null;
}

function isFileInput(element) {
  const name = element.name.toLowerCase();
  const isInput = name === 'input' || name.endsWith('input');
  return isInput && literalAttributeValue(element, ['type', 'inputType', 'kind'])?.toLowerCase() === 'file';
}

function isInteractive(element) {
  const name = element.name.toLowerCase();
  return name === 'button'
    || name === 'link'
    || (name === 'label' && literalAttributeValue(element, ['htmlFor', 'for']) !== null)
    || name.endsWith('button')
    || name.endsWith('link')
    || /\b(?:press|onPress|onClick|click|href)\s*=/.test(element.openingSource);
}

function isLinkedFileInputLabel(element, allElements) {
  if (element.name.toLowerCase() !== 'label') return false;
  const targetId = literalAttributeValue(element, ['htmlFor', 'for']);
  return targetId !== null && allElements.some((candidate) =>
    isFileInput(candidate) && literalAttributeValue(candidate, ['id']) === targetId);
}

function isStructurallyContradictoryChooser(element) {
  const name = element.name.toLowerCase();
  if (name === 'link' || name.endsWith('link') || hasValueCarrier(element.openingSource, ['href'])) {
    return true;
  }
  return hasSelectedState(element.openingSource)
    || literalAttributeValue(element, ['role']) === 'tab';
}

function isChooserControl(element, allElements) {
  if (isFileInput(element)) return true;
  if (isLinkedFileInputLabel(element, allElements)) return true;
  if (!isInteractive(element) || isStructurallyContradictoryChooser(element)) return false;
  return true;
}

function containsRenderedMedia(element) {
  return [element, ...element.descendants].some((candidate) =>
    ['image', 'img', 'video'].includes(candidate.name.toLowerCase()));
}

function containsFeedSurface(element) {
  // The authority requires the trending row to compose a feed-card surface.
  // Statically that means a PARSED element (self or descendant) carrying the
  // literal sm-feed-item test ID — any element name qualifies — or a
  // descendant whose component name is the FeedCard family (opaque
  // composition whose test IDs live inside the component).
  return [element, ...element.descendants].some((candidate) => {
    const leafName = candidate.name.split('.').at(-1) ?? candidate.name;
    if (/^(?:Coterie)?FeedCard$/.test(leafName)) return true;
    return elementHasLiteralTestId(candidate, 'sm-feed-item');
  });
}

function hasValueCarrier(line, names) {
  return new RegExp(`\\b(?:${names.join('|')})\\s*=`).test(line);
}

function literalAttributeValues(line, names) {
  const pattern = new RegExp(
    `\\b(?:${names.join('|')})\\s*=\\s*(?:\\{\\s*)?["'\`]([^"'\`]+)["'\`]`,
    'g',
  );
  return [...line.matchAll(pattern)].map((match) => match[1]);
}

function hasSelectedState(line) {
  return hasValueCarrier(line, [
    'accessibilitySelected',
    'aria-pressed',
    'ariaPressed',
    'checked',
    'data-selected',
    'dataSelected',
    'selected',
  ]);
}

function pushError(errors, use, code, message) {
  errors.push({
    filePath: use.filePath,
    line: use.line,
    column: use.column,
    id: use.id,
    code,
    message,
  });
}

function validateSemanticUse(use, element, allElements, errors) {
  if (!element) return;
  const line = element.openingSource;

  if (use.id === 'sm-trending-row') {
    if (!containsFeedSurface(element)) {
      pushError(
        errors,
        use,
        'SM_TRENDING_ROW_COMPOSITION',
        'sm-trending-row must compose a FeedCard/sm-feed-item surface',
      );
    }
    return;
  }

  if (use.id === 'sm-chatsettings-color') {
    if (!isInteractive(element)) {
      pushError(errors, use, 'SM_CHAT_COLOR_ELEMENT', 'sm-chatsettings-color must label an interactive option');
    }
    if (!hasValueCarrier(line, [
      'accessibilityValue',
      'aria-label',
      'data-value',
      'dataValue',
      'label',
      'value',
      'valueText',
    ])) {
      pushError(errors, use, 'SM_CHAT_COLOR_VALUE', 'sm-chatsettings-color must expose a stable value or accessible label');
    }
    if (!hasSelectedState(line)) {
      pushError(errors, use, 'SM_CHAT_COLOR_SELECTED_STATE', 'sm-chatsettings-color must expose selected state');
    }
    return;
  }

  if (use.id === 'sm-chatsettings-disappearing') {
    const directValueNames = [
      'accessibilityValue',
      'aria-valuetext',
      'data-value',
      'dataValue',
      'value',
      'valueText',
    ];
    const valueNames = [...directValueNames, 'aria-label', 'label'];
    if (!isInteractive(element)) {
      pushError(errors, use, 'SM_CHAT_DISAPPEARING_ELEMENT', 'sm-chatsettings-disappearing must label an interactive option');
    }
    if (!hasValueCarrier(line, valueNames)) {
      pushError(errors, use, 'SM_CHAT_DISAPPEARING_VALUE', 'sm-chatsettings-disappearing must expose off, 24h, or 7d');
    } else {
      const directValues = literalAttributeValues(line, directValueNames)
        .map((value) => value.trim().toLowerCase());
      const accessibleLabels = literalAttributeValues(line, ['aria-label', 'label']);
      const invalidDirectValue = directValues.some((value) => !DISAPPEARING_VALUES.has(value));
      const labelPinsValue = accessibleLabels.some((label) =>
        [...DISAPPEARING_VALUES].some((value) =>
          new RegExp(`(?:^|\\b)${escapeRegExp(value)}(?:\\b|$)`, 'i').test(label)
        )
      );
      if (invalidDirectValue || (directValues.length === 0 && accessibleLabels.length > 0 && !labelPinsValue)) {
        pushError(errors, use, 'SM_CHAT_DISAPPEARING_VALUE', 'literal disappearing value must be off, 24h, or 7d');
      }
    }
    if (!hasSelectedState(line)) {
      pushError(errors, use, 'SM_CHAT_DISAPPEARING_SELECTED_STATE', 'sm-chatsettings-disappearing must expose selected state');
    }
    return;
  }

  if (use.id === 'sm-convo-file') {
    if (!isFileInput(element)) {
      pushError(errors, use, 'SM_CONVO_FILE_ELEMENT', 'sm-convo-file is reserved for a real file input');
    }
    return;
  }

  if (use.id === 'sm-convo-attach' || use.id === 'sm-chatsettings-background') {
    if (!isChooserControl(element, allElements)) {
      pushError(errors, use, 'SM_FILE_CHOOSER_ELEMENT', `${use.id} must label a file input or interactive chooser trigger`);
    }
    return;
  }

  if (use.id === 'sm-convo-media' || use.id === 'sm-chatsettings-background-preview') {
    if (!containsRenderedMedia(element)) {
      pushError(errors, use, 'SM_RENDERED_MEDIA_ELEMENT', `${use.id} must contain a real image or video node`);
    }
    return;
  }

  if (INTERACTIVE_ACTION_IDS.has(use.id) && !isInteractive(element)) {
    pushError(errors, use, 'SM_INTERACTIVE_ACTION_ELEMENT', `${use.id} must label an interactive control`);
  }
}

export function checkSmVocabulary({
  authorityPath = DEFAULT_AUTHORITY,
  sourcePaths = [resolve(APP_ROOT, 'src')],
} = {}) {
  const authoritySource = readFileSync(authorityPath, 'utf8');
  const frozenIds = extractFrozenSmIds(authoritySource);
  const files = collectSourceFiles(sourcePaths);
  const literalUses = [];
  const extensionIds = new Set();
  const errors = [];

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8');
    const records = sourceLines(source);
    const elements = collectSemanticElements(source, filePath);
    for (let lineIndex = 0; lineIndex < records.length; lineIndex += 1) {
      const { line, offset } = records[lineIndex];
      for (const match of line.matchAll(SM_ID_PATTERN)) {
        const use = {
          filePath,
          line: lineIndex + 1,
          column: (match.index ?? 0) + 1,
          offset: offset + (match.index ?? 0),
          id: match[0],
        };
        literalUses.push(use);
        if (!frozenIds.has(use.id)) {
          extensionIds.add(use.id);
          continue;
        }
        validateSemanticUse(use, semanticElementForUse(elements, use), elements, errors);
      }
    }
  }

  errors.sort((left, right) =>
    compareCodeUnit(left.filePath, right.filePath)
    || left.line - right.line
    || left.column - right.column
    || compareCodeUnit(left.code, right.code));
  return {
    ok: errors.length === 0,
    authorityPath,
    files,
    frozenIds: [...frozenIds].sort(compareCodeUnit),
    literalUses,
    extensionIds: [...extensionIds].sort(compareCodeUnit),
    errors,
  };
}

export function formatSmVocabularyReport(report, { cwd = process.cwd() } = {}) {
  const frozenUseCount = report.literalUses.filter((use) => report.frozenIds.includes(use.id)).length;
  const lines = [];
  if (report.extensionIds.length > 0) {
    lines.push(`sm-vocabulary: extensions allowed: ${report.extensionIds.join(', ')}`);
  }
  for (const error of report.errors) {
    lines.push(
      `${relative(cwd, error.filePath) || error.filePath}:${error.line}:${error.column} `
      + `[${error.code}] ${error.message}`,
    );
  }
  lines.push(
    report.ok
      ? `sm-vocabulary: PASS (${frozenUseCount} frozen-ID literal uses across ${report.files.length} files)`
      : `sm-vocabulary: FAIL (${report.errors.length} frozen-ID misuses across ${report.files.length} files)`,
  );
  return lines.join('\n');
}

function parseCliArgs(argv) {
  let authorityPath = DEFAULT_AUTHORITY;
  const sourcePaths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--authority') {
      const value = argv[index + 1];
      if (!value) throw new Error('--authority requires a path');
      authorityPath = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`);
    sourcePaths.push(resolve(argument));
  }
  return {
    authorityPath,
    sourcePaths: sourcePaths.length > 0 ? sourcePaths : [resolve(APP_ROOT, 'src')],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = checkSmVocabulary(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${formatSmVocabularyReport(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`sm-vocabulary: ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
