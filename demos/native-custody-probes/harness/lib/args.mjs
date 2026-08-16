import { resolve } from 'node:path';

export function parseArgs(argv, platform, defaults) {
  const values = {
    ...defaults,
    help: false,
    skipBuild: false,
    preserveKeychain: false,
  };
  const boolean = new Map([
    ['--help', 'help'],
    ['--skip-build', 'skipBuild'],
    ['--preserve-keychain', 'preserveKeychain'],
  ]);
  const named = new Map([
    ['--director-port', ['directorPort', Number]],
    ['--server-port', ['serverPort', Number]],
    ['--metro-port', ['metroPort', Number]],
    ['--iterations', ['iterations', Number]],
    ['--email', ['email', String]],
    ['--password', ['password', String]],
    ['--bundle-id', ['bundleId', String]],
    ['--udid', ['udid', String]],
    ['--derived-data', ['derivedData', resolve]],
    ['--app-path', ['appPath', resolve]],
    ['--ios-extension-evidence', ['iosExtensionEvidence', resolve]],
    ['--adb', ['adb', String]],
    ['--serial', ['serial', String]],
    ['--avd', ['avd', String]],
    ['--emulator', ['emulator', String]],
    ['--apk', ['apk', resolve]],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (boolean.has(token)) {
      values[boolean.get(token)] = true;
      continue;
    }
    const entry = named.get(token);
    if (entry === undefined) throw new Error(`unknown ${platform} harness option ${token}`);
    const raw = argv[index + 1];
    if (raw === undefined) throw new Error(`${token} requires a value`);
    values[entry[0]] = entry[1](raw);
    index += 1;
  }
  for (const name of ['directorPort', 'serverPort', 'metroPort', 'iterations']) {
    if (!Number.isSafeInteger(values[name]) || values[name] <= 0) {
      throw new Error(`--${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} must be a positive integer`);
    }
  }
  return Object.freeze(values);
}

export function harnessUsage(platform) {
  const targetOptions = platform === 'iOS'
    ? '  --udid <id> --derived-data <path> --app-path <path>\n  --ios-extension-evidence <path> --preserve-keychain\n  iOS Debug requires harness-owned Metro on --metro-port 8081'
    : '  --serial <id> --avd <name> --adb <path> --emulator <path> --apk <path>';
  return `${platform} native custody probe harness

Options:
  --skip-build --iterations <count>
  --server-port <port> --director-port <port> --metro-port <port>
  --bundle-id <id> --email <email> --password <password>
${targetOptions}
  --help

All target selectors and artifact paths also have environment-backed discovery defaults.`;
}
