export function webdriverCapabilities({ browserName, phase4Claim, iosSimulatorUdid }) {
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
  if (browserName === 'safari') return { browserName: 'safari' };
  throw new Error(`unsupported WebDriver browser: ${browserName}`);
}
