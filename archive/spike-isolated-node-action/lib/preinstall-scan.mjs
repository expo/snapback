import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

function tarEntries(compressed) {
  const bytes = gunzipSync(compressed);
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
    const name = `${string(345, 155)}${string(345, 155) ? '/' : ''}${string(0, 100)}`;
    const size = Number.parseInt(string(124, 12).trim() || '0', 8);
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    entries.push({ name, size, body });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function refuseRegistryPackageBeforeInstall(name, version) {
  const metadataUrl = new URL(`${encodeURIComponent(name).replace('%40', '@')}/${version}`, 'https://registry.npmjs.org/');
  if (metadataUrl.origin !== 'https://registry.npmjs.org') throw new Error('registry-only spike invariant failed');
  const metadataResponse = await fetch(metadataUrl);
  if (!metadataResponse.ok) throw new Error(`registry metadata failed: ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const tarballUrl = new URL(metadata.dist.tarball);
  if (tarballUrl.origin !== 'https://registry.npmjs.org') throw new Error(`non-registry tarball refused: ${tarballUrl.origin}`);
  const tarballResponse = await fetch(tarballUrl);
  if (!tarballResponse.ok) throw new Error(`registry tarball failed: ${tarballResponse.status}`);
  const tarballBytes = Buffer.from(await tarballResponse.arrayBuffer());
  const [integrityAlgorithm, expectedIntegrity] = String(metadata.dist.integrity).split('-', 2);
  if (!['sha256', 'sha384', 'sha512'].includes(integrityAlgorithm) || !expectedIntegrity) {
    throw new Error(`registry tarball has unsupported integrity ${metadata.dist.integrity}`);
  }
  const actualIntegrity = createHash(integrityAlgorithm).update(tarballBytes).digest();
  const expectedIntegrityBytes = Buffer.from(expectedIntegrity, 'base64');
  if (actualIntegrity.length !== expectedIntegrityBytes.length
    || !timingSafeEqual(actualIntegrity, expectedIntegrityBytes)) {
    throw new Error(`registry tarball integrity mismatch for ${name}@${version}`);
  }
  const entries = tarEntries(tarballBytes);
  const packageJsonEntry = entries.find(({ name: path }) => path === 'package/package.json');
  if (!packageJsonEntry) throw new Error(`registry tarball for ${name}@${version} has no package/package.json`);
  const tarballManifest = JSON.parse(packageJsonEntry.body.toString('utf8'));
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare']
    .filter((script) => tarballManifest.scripts?.[script])
    .map((script) => ({ script, command: tarballManifest.scripts[script] }));
  const nativeEntries = entries
    .map(({ name: path }) => path)
    .filter((path) => path.endsWith('/binding.gyp') || path.endsWith('.node'));
  if (lifecycle.length === 0 && tarballManifest.gypfile !== true && nativeEntries.length === 0) {
    throw new Error(`${name}@${version} did not provide the intended install/native-addon refusal control`);
  }
  return {
    admitted: false,
    code: lifecycle.length > 0
      ? 'SNAPBACK_ISOLATED_NODE_DEPENDENCY_INSTALL_SCRIPT'
      : 'SNAPBACK_ISOLATED_NODE_NATIVE_ADDON_REFUSED',
    message: `${name}@${version} refused before install: ${lifecycle.map(({ script, command }) => `${script}=${JSON.stringify(command)}`).join(', ') || 'native addon metadata'}`,
    remediation: 'choose a pure-JS ESM package with no install/prepare/postinstall lifecycle and no binding.gyp/.node payload',
    evidence: {
      metadataUrl: metadataUrl.href,
      tarballUrl: tarballUrl.href,
      integrity: metadata.dist.integrity,
      integrityVerified: true,
      registryScripts: metadata.scripts ?? {},
      tarballScripts: tarballManifest.scripts ?? {},
      gypfile: tarballManifest.gypfile ?? null,
      nativeEntries,
      tarballEntriesInspected: entries.length,
      installAttempted: false,
    },
  };
}
