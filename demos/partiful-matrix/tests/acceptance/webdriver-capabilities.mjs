export function webdriverCapabilities({
  browserName,
  phase4Claim,
  iosSimulatorUdid,
  iosDeviceUdid,
}) {
  if (browserName === 'firefox') {
    const reducedMotion = phase4Claim === 'STEP4.UI.REDUCED-MOTION';
    const needsBidiViewport = ['STEP4.UI.RESPONSIVE', 'STEP4.UI.VISUAL'].includes(phase4Claim);
    return {
      browserName: 'firefox',
      ...(needsBidiViewport ? { webSocketUrl: true } : {}),
      'moz:firefoxOptions': {
        args: ['-headless'],
        prefs: { 'ui.prefersReducedMotion': reducedMotion ? 1 : 0 },
      },
    };
  }
  if (browserName === 'ios-safari') {
    if (!iosSimulatorUdid) throw new Error('iOS Safari WebDriver requires an explicit simulator UDID');
    return {
      browserName: 'safari',
      platformName: 'ios',
      'safari:useSimulator': true,
      'safari:deviceUDID': iosSimulatorUdid,
    };
  }
  if (browserName === 'ios-safari-device') {
    if (!iosDeviceUdid) throw new Error('physical iOS Safari WebDriver requires an explicit device UDID');
    return {
      browserName: 'safari',
      platformName: 'ios',
      'safari:useSimulator': false,
      'safari:deviceType': 'iPhone',
      'safari:deviceUDID': iosDeviceUdid,
    };
  }
  if (browserName === 'safari') return { browserName: 'safari' };
  throw new Error(`unsupported WebDriver browser: ${browserName}`);
}

export function isPrivateDeviceReachableIpv4(value) {
  if (typeof value !== 'string') return false;
  const octets = value.split('.').map((part) => Number(part));
  if (
    octets.length !== 4
    || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = octets;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127);
}
