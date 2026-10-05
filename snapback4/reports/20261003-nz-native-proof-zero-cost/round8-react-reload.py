"""Reproduce the immutable React fixture's navigation failure, then its fix.

This diagnostic injects a real Vite full-reload message during the existing
terminal-refusal assertion. It does not establish which event triggered the
original intermittent suite navigation. The original suite log is retained.
"""
import argparse, pathlib, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--log-prefix', default='/tmp/sb4-nz-r8-react-reload')
args = parser.parse_args()

ROOT = pathlib.Path(__file__).resolve().parents[3]
REL = 'snapback4/packages/snapback4/test/per-row-react.test.mjs'
NODE = pathlib.Path.home()/'.volta/tools/image/node/24.18.0/bin/node'
probe = ROOT/REL
probe = probe.with_name('.nz-r8-react-probe.mjs')
assert not probe.exists()
base = subprocess.check_output(['git', 'show', 'aa75cab431:'+REL], cwd=ROOT, text=True)
source = base.replace("const page = await browser.newPage();", """const page = await browser.newPage();
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log('NZ_NAVIGATION', frame.url()); });
  await page.exposeFunction('nzReload', () => {
    console.log('NZ_VITE_SEND full-reload');
    server.ws.send({ type: 'full-reload', path: '*' });
  });""")
needle = 'await page.waitForFunction(() => window.batch.denied());'
assert source.count(needle) == 1
source = source.replace(needle, needle + """
  await page.evaluate(() => window.nzReload());
  await new Promise(resolve => setTimeout(resolve, 300));""")
try:
    for mode in ['before', 'after']:
        text = source
        if mode == 'after':
            text = text.replace("server: { host: '127.0.0.1', port: 0,",
                                "server: { hmr: false, watch: null, host: '127.0.0.1', port: 0,")
        probe.write_text(text)
        log = pathlib.Path(f'{args.log_prefix}-{mode}.log')
        assert not log.exists(), 'preserve earlier diagnostics; choose a fresh output path'
        with log.open('w') as out:
            result = subprocess.run([str(NODE), '--test', '--test-name-pattern=terminal refusal', str(probe)],
                                    cwd=ROOT, stdout=out, stderr=out)
        assert result.returncode == (1 if mode == 'before' else 0), log.read_text()
        print(mode, result.returncode)
finally:
    probe.unlink(missing_ok=True)
