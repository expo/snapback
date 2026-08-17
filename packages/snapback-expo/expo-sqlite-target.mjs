// @ref LLP 0270#d6-arm-claims-are-receipt-scoped — framework-owned runtime
// facts must match the receipt's complete target cell before activation.
// Framework-owned target-cell facts for the no-ceremony Expo SQLite path.
// The guarded literal requires let Metro include the native packages while
// web and incomplete native closures fail closed without importing them.

const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const usableString = (value) => nonEmptyString(value) && value !== 'unknown';
const moduleValue = (value) => value?.default ?? value;

async function loadReactNative(resolveReactNativeModule) {
  if (typeof resolveReactNativeModule === 'function') {
    return moduleValue(await resolveReactNativeModule());
  }
  if (typeof require !== 'function') return null;
  try { return moduleValue(require('react-native')); } catch { return null; }
}

async function loadExpoDevice(resolveExpoDeviceModule) {
  if (typeof resolveExpoDeviceModule === 'function') {
    return moduleValue(await resolveExpoDeviceModule());
  }
  if (typeof require !== 'function') return null;
  try { return moduleValue(require('expo-device')); } catch { return null; }
}

export async function resolveDefaultExpoSqliteOperatingSystem({
  resolveReactNativeModule,
} = {}) {
  const reactNative = await loadReactNative(resolveReactNativeModule);
  const operatingSystem = reactNative?.Platform?.OS;
  return usableString(operatingSystem) ? operatingSystem : 'unknown';
}

export async function resolveDefaultExpoSqliteTarget({
  operatingSystem = null,
  resolveReactNativeModule,
  resolveExpoDeviceModule,
} = {}) {
  const [reactNative, expoDevice] = await Promise.all([
    loadReactNative(resolveReactNativeModule),
    loadExpoDevice(resolveExpoDeviceModule),
  ]);
  const platform = reactNative?.Platform;
  const os = usableString(operatingSystem) ? operatingSystem : platform?.OS;
  const osVersion = platform?.Version == null ? null : String(platform.Version);
  const architectures = Array.isArray(expoDevice?.supportedCpuArchitectures)
    ? [...new Set(expoDevice.supportedCpuArchitectures.filter(usableString))].sort()
    : [];
  const deviceClass = expoDevice?.isDevice === true
    ? 'real-device'
    : expoDevice?.isDevice === false && os === 'android'
      ? 'emulator'
      : expoDevice?.isDevice === false && os === 'ios'
        ? 'simulator'
        : null;
  const distribution = typeof __DEV__ === 'boolean' && __DEV__
    ? 'development'
    : 'release';
  return Object.freeze({
    ...(usableString(os) ? { operatingSystem: os } : {}),
    ...(usableString(osVersion) ? { osVersion } : {}),
    ...(architectures.length > 0 ? { architecture: architectures.join('+') } : {}),
    distribution,
    ...(deviceClass === null ? {} : { deviceClass }),
  });
}
