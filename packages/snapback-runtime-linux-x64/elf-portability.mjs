#!/usr/bin/env node

// @ref LLP 0041#linux-runtime-self-containment--2026-08-08 — published Linux
// runtimes carry every non-baseline shared library beside Hermes and prove the
// executable's transitive loader path without depending on host tooling.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ELF64_HEADER_BYTES = 64;
const ELF64_SECTION_HEADER_BYTES = 64;
const ELF64_DYNAMIC_ENTRY_BYTES = 16;
const SHT_STRTAB = 3;
const SHT_DYNAMIC = 6;
const DT_NULL = 0n;
const DT_NEEDED = 1n;
const DT_SONAME = 14n;
const DT_RPATH = 15n;
const DT_RUNPATH = 29n;
const PORTABILITY_CODE = 'SNAPBACK_RUNTIME_LINUX_PORTABILITY_VIOLATION';
const BUNDLE_RESOLUTION_CODE =
  'SNAPBACK_RUNTIME_LINUX_BUNDLE_RESOLUTION_FAILED';

export const LINUX_PORTABLE_HOST_SONAMES = Object.freeze(new Set([
  'ld-linux-x86-64.so.2',
  'libc.so.6',
  'libm.so.6',
  'libpthread.so.0',
  'libdl.so.2',
  'librt.so.1',
  'libresolv.so.2',
  'libutil.so.1',
  'libgcc_s.so.1',
  'libstdc++.so.6',
]));

function malformed(path, message, cause = undefined) {
  return new TypeError(`malformed ELF ${path}: ${message}`, { cause });
}

function codedError(code, message, cause = undefined) {
  const error = new Error(message, { cause });
  error.code = code;
  return error;
}

function checkedRange(bytes, offset, size, path, label) {
  if (
    offset < 0n
    || size < 0n
    || offset > BigInt(bytes.byteLength)
    || size > BigInt(bytes.byteLength) - offset
    || offset > BigInt(Number.MAX_SAFE_INTEGER)
    || size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw malformed(path, `${label} is outside the file`);
  }
  return { offset: Number(offset), size: Number(size) };
}

function sectionAt(bytes, path, sectionTableOffset, sectionEntrySize, index) {
  const offset = sectionTableOffset + (BigInt(sectionEntrySize) * BigInt(index));
  const range = checkedRange(
    bytes,
    offset,
    BigInt(ELF64_SECTION_HEADER_BYTES),
    path,
    `section header ${index}`,
  );
  return {
    type: bytes.readUInt32LE(range.offset + 4),
    offset: bytes.readBigUInt64LE(range.offset + 24),
    size: bytes.readBigUInt64LE(range.offset + 32),
    link: bytes.readUInt32LE(range.offset + 40),
    entrySize: bytes.readBigUInt64LE(range.offset + 56),
  };
}

function dynamicString(bytes, path, stringTable, stringOffset, label) {
  if (stringOffset >= stringTable.size) {
    throw malformed(path, `${label} offset is outside the dynamic string table`);
  }
  const start = stringTable.offset + stringOffset;
  const range = checkedRange(
    bytes,
    start,
    stringTable.size - stringOffset,
    path,
    `${label} string`,
  );
  const end = bytes.indexOf(0, range.offset);
  if (end < range.offset || end >= range.offset + range.size) {
    throw malformed(path, `${label} is not NUL-terminated in the dynamic string table`);
  }
  return bytes.toString('utf8', range.offset, end);
}

export function readElfDynamicInfo(path) {
  path = resolve(path);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw malformed(path, `could not be read: ${error.message}`, error);
  }
  if (bytes.byteLength < ELF64_HEADER_BYTES) {
    throw malformed(path, `is shorter than the ${ELF64_HEADER_BYTES}-byte ELF64 header`);
  }
  if (!bytes.subarray(0, ELF_MAGIC.byteLength).equals(ELF_MAGIC)) {
    throw malformed(path, 'does not start with the ELF magic');
  }
  if (bytes[4] !== 2) throw malformed(path, 'is not ELF64 (EI_CLASS must be 2)');
  if (bytes[5] !== 1) {
    throw malformed(path, 'is not little-endian (EI_DATA must be 1)');
  }

  const machine = bytes.readUInt16LE(18);
  const sectionTableOffset = bytes.readBigUInt64LE(40);
  const sectionEntrySize = bytes.readUInt16LE(58);
  const sectionCount = bytes.readUInt16LE(60);
  if (sectionCount > 0 && sectionEntrySize < ELF64_SECTION_HEADER_BYTES) {
    throw malformed(
      path,
      `section header entry size ${sectionEntrySize} is smaller than ${ELF64_SECTION_HEADER_BYTES}`,
    );
  }
  if (sectionCount > 0) {
    checkedRange(
      bytes,
      sectionTableOffset,
      BigInt(sectionEntrySize) * BigInt(sectionCount),
      path,
      'section header table',
    );
  }

  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    sections.push(sectionAt(
      bytes,
      path,
      sectionTableOffset,
      sectionEntrySize,
      index,
    ));
  }

  const needed = [];
  let soname = null;
  const rpath = [];
  const runpath = [];
  for (const [sectionIndex, section] of sections.entries()) {
    if (section.type !== SHT_DYNAMIC) continue;
    if (section.entrySize !== BigInt(ELF64_DYNAMIC_ENTRY_BYTES)) {
      throw malformed(
        path,
        `dynamic section ${sectionIndex} entry size must be ${ELF64_DYNAMIC_ENTRY_BYTES}`,
      );
    }
    if (section.size % BigInt(ELF64_DYNAMIC_ENTRY_BYTES) !== 0n) {
      throw malformed(path, `dynamic section ${sectionIndex} has a partial entry`);
    }
    if (section.link >= sections.length) {
      throw malformed(path, `dynamic section ${sectionIndex} has an invalid string-table link`);
    }
    const dynamicRange = checkedRange(
      bytes,
      section.offset,
      section.size,
      path,
      `dynamic section ${sectionIndex}`,
    );
    const linkedStringSection = sections[section.link];
    if (linkedStringSection.type !== SHT_STRTAB) {
      throw malformed(
        path,
        `dynamic section ${sectionIndex} does not link to an SHT_STRTAB section`,
      );
    }
    const stringRange = checkedRange(
      bytes,
      linkedStringSection.offset,
      linkedStringSection.size,
      path,
      `dynamic string table ${section.link}`,
    );
    const stringTable = {
      offset: BigInt(stringRange.offset),
      size: BigInt(stringRange.size),
    };
    for (
      let entryOffset = dynamicRange.offset;
      entryOffset < dynamicRange.offset + dynamicRange.size;
      entryOffset += ELF64_DYNAMIC_ENTRY_BYTES
    ) {
      const tag = bytes.readBigInt64LE(entryOffset);
      if (tag === DT_NULL) break;
      if (![DT_NEEDED, DT_SONAME, DT_RPATH, DT_RUNPATH].includes(tag)) continue;
      const value = dynamicString(
        bytes,
        path,
        stringTable,
        bytes.readBigUInt64LE(entryOffset + 8),
        `dynamic tag ${tag}`,
      );
      if (tag === DT_NEEDED) needed.push(value);
      else if (tag === DT_SONAME) soname = value;
      else if (tag === DT_RPATH) rpath.push(...value.split(':'));
      else runpath.push(...value.split(':'));
    }
  }

  return { machine, needed, soname, rpath, runpath };
}

function startsWithElfMagic(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const magic = Buffer.alloc(ELF_MAGIC.byteLength);
    return readSync(descriptor, magic, 0, magic.byteLength, 0) === magic.byteLength
      && magic.equals(ELF_MAGIC);
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function regularLibraryFiles(libDirectory) {
  return readdirSync(libDirectory)
    .sort()
    .map((name) => ({ name, path: join(libDirectory, name) }))
    .filter(({ path }) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

function inspectLinuxPackage({ binaryPath, libDirectory }) {
  binaryPath = resolve(binaryPath);
  libDirectory = resolve(libDirectory);
  let libraryFiles = [];
  const violations = [];
  try {
    libraryFiles = regularLibraryFiles(libDirectory);
  } catch (error) {
    violations.push(`library directory ${libDirectory} could not be read: ${error.message}`);
  }
  const elfPaths = [
    { path: binaryPath, binary: true },
    ...libraryFiles
      .filter(({ path }) => startsWithElfMagic(path))
      .map(({ path }) => ({ path, binary: false })),
  ];
  const infos = [];
  for (const elf of elfPaths) {
    try {
      infos.push({ ...elf, info: readElfDynamicInfo(elf.path) });
    } catch (error) {
      violations.push(`${elf.path} is not a valid ELF64 little-endian file: ${error.message}`);
    }
  }
  return { binaryPath, libDirectory, libraryFiles, elfPaths, infos, violations };
}

export function verifyLinuxPackagePortability({
  binaryPath,
  libDirectory,
  allowlist = LINUX_PORTABLE_HOST_SONAMES,
}) {
  const inspection = inspectLinuxPackage({ binaryPath, libDirectory });
  const violations = [...inspection.violations];
  const bundledSonames = new Set(inspection.libraryFiles.map(({ name }) => name));
  for (const { path, binary, info } of inspection.infos) {
    if (info.machine !== 62) {
      violations.push(`${path} has e_machine ${info.machine}; expected EM_X86_64 (62)`);
    }
    for (const needed of info.needed) {
      if (!allowlist.has(needed) && !bundledSonames.has(needed)) {
        violations.push(
          `${path} needs ${needed}, which is neither host-allowlisted nor a regular file in ${inspection.libDirectory}`,
        );
      }
    }
    if (binary) {
      if (!info.rpath.includes('$ORIGIN/../lib')) {
        violations.push(`${path} is missing DT_RPATH $ORIGIN/../lib`);
      }
      if (info.runpath.length > 0) {
        violations.push(
          `${path} carries DT_RUNPATH (${info.runpath.join(':')}); transitive bundled dependencies require DT_RPATH`,
        );
      }
    } else if (info.runpath.length > 0) {
      violations.push(
        `${path} is a bundled ELF carrying DT_RUNPATH (${info.runpath.join(':')})`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}

export function assertLinuxPackagePortability(options) {
  const verdict = verifyLinuxPackagePortability(options);
  if (verdict.ok) return verdict;
  throw codedError(
    PORTABILITY_CODE,
    `Linux runtime package portability violations:\n${verdict.violations.map((violation) => `- ${violation}`).join('\n')}`,
  );
}

function resolveHostSonames() {
  const result = spawnSync('/sbin/ldconfig', ['-p'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message
      ?? result.stderr?.trim()
      ?? result.signal
      ?? result.status
      ?? 'unknown failure';
    throw codedError(
      BUNDLE_RESOLUTION_CODE,
      `could not resolve host shared libraries with /sbin/ldconfig -p: ${detail}`,
      result.error,
    );
  }
  const sonames = new Map();
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = /^\s*(\S+)\s+\(([^)]*)\)\s+=>\s+(\S+)\s*$/u.exec(line);
    if (!match || !match[2].includes('libc6,x86-64')) continue;
    if (!sonames.has(match[1])) sonames.set(match[1], match[3]);
  }
  return sonames;
}

export function bundleLinuxRuntimeSharedLibraries({
  binaryPath,
  libDirectory,
  allowlist = LINUX_PORTABLE_HOST_SONAMES,
}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw codedError(
      'SNAPBACK_IBEX_HOST_UNSUPPORTED',
      `Linux runtime shared-library bundling requires linux-x64 (observed ${process.platform}-${process.arch})`,
    );
  }
  binaryPath = resolve(binaryPath);
  libDirectory = resolve(libDirectory);
  mkdirSync(libDirectory, { recursive: true });
  const hostSonames = resolveHostSonames();
  const existingLibraries = regularLibraryFiles(libDirectory);
  const worklist = [
    binaryPath,
    ...existingLibraries
      .filter(({ path }) => startsWithElfMagic(path))
      .map(({ path }) => path),
  ];
  const copied = new Map();
  for (let index = 0; index < worklist.length; index += 1) {
    const current = worklist[index];
    const info = readElfDynamicInfo(current);
    for (const soname of info.needed) {
      const destination = join(libDirectory, soname);
      let alreadyBundled = false;
      try {
        alreadyBundled = statSync(destination).isFile();
      } catch {
        alreadyBundled = false;
      }
      if (allowlist.has(soname) || alreadyBundled) continue;
      const resolved = hostSonames.get(soname);
      if (!resolved) {
        throw codedError(
          BUNDLE_RESOLUTION_CODE,
          `could not resolve required x86-64 shared library ${soname} with /sbin/ldconfig -p`,
        );
      }
      let sourcePath;
      try {
        sourcePath = realpathSync(resolved);
        copyFileSync(sourcePath, destination);
        chmodSync(destination, 0o755);
      } catch (error) {
        throw codedError(
          BUNDLE_RESOLUTION_CODE,
          `could not bundle ${soname} from ${resolved}: ${error.message}`,
          error,
        );
      }
      copied.set(soname, sourcePath);
      worklist.push(destination);
    }
  }
  return [...copied]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([soname, sourcePath]) => ({ soname, sourcePath }));
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw codedError(PORTABILITY_CODE, `${argument ?? 'option'} requires a value`);
    }
    const key = { '--binary': 'binaryPath', '--lib': 'libDirectory' }[argument];
    if (!key || Object.hasOwn(options, key)) {
      throw codedError(PORTABILITY_CODE, `unknown or duplicate option ${argument}`);
    }
    options[key] = value;
  }
  if (!options.binaryPath || !options.libDirectory) {
    throw codedError(
      PORTABILITY_CODE,
      'usage: elf-portability.mjs --binary <path> --lib <directory>',
    );
  }
  return options;
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const verdict = assertLinuxPackagePortability(options);
    const inspection = inspectLinuxPackage(options);
    console.log(
      `Linux ELF portability OK: ${inspection.infos.length} ELF files, ${inspection.libraryFiles.length} bundled files`,
    );
    return verdict;
  } catch (error) {
    console.error(`${error?.code ?? PORTABILITY_CODE}: ${error?.message ?? error}`);
    process.exitCode = 1;
    return null;
  }
}

if (
  process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
