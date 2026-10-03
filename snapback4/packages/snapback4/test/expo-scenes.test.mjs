import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { nativeReferences } from '../../../crates/snapback4/src/verbs/witness/native-inputs.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const plist = require('@expo/plist').default;
const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/chat-expo/app.json')));
const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'apps/chat-expo/package.json')));

test('chat prebuild adopts Expo scenes and retains linking and status bar configuration', () => {
  fs.mkdirSync(path.join(root, 'target'), { recursive: true });
  const project = fs.mkdtempSync(path.join(root, 'target/scene-prebuild-'));
  const build = () => {
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'),
      'prebuild', '--platform', 'ios', '--no-install', '--template', path.join(root, 'node_modules/expo/template.tgz')], {
      cwd: project, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_GIT_STATUS: '1' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const ios = path.join(project, 'ios/Snapback4chat');
    return { info: plist.parse(fs.readFileSync(path.join(ios, 'Info.plist'), 'utf8')),
      delegate: fs.readFileSync(path.join(ios, 'AppDelegate.swift'), 'utf8') };
  };
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(project, 'node_modules'));
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify(packageJSON));
    fs.writeFileSync(path.join(project, 'app.json'), JSON.stringify(app));
    const generated = build();
    assert.equal(generated.info.UIApplicationSceneManifest?.UIApplicationSupportsMultipleScenes, false);
    assert.equal(generated.info.UIApplicationSceneManifest.UISceneConfigurations
      .UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).SceneDelegate');
    assert.match(generated.delegate, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
    assert.equal(generated.delegate.match(/factory.startReactNative\(/g)?.length, 1);
    assert.match(generated.delegate, /UIWindow\(windowScene: scene\)/);
    assert.doesNotMatch(generated.delegate, /UIWindow\(frame: UIScreen.main.bounds\)/);
    assert.match(generated.delegate, /reactNativeFactory = factory/);
    assert.match(generated.delegate, /RCTLinkingManager.application/);
    assert.equal(generated.info.UIViewControllerBasedStatusBarAppearance, false);
    assert.ok(generated.info.CFBundleURLTypes.some(row => row.CFBundleURLSchemes.includes('snapback4chat')));
    assert.match(generated.delegate, /app.application\(UIApplication.shared, open: context.url/);
    assert.match(generated.delegate, /app.application\(UIApplication.shared, continue: activity/);
    assert.deepEqual(build(), generated, 'repeated prebuild preserves the scene output');
    assert.doesNotThrow(() => nativeReferences(project, { objects: {} }, 'Snapback4chat'));
    fs.appendFileSync(path.join(project, 'ios/Podfile'), '\nputs \"custom pod hook\"\n');
    assert.throws(() => nativeReferences(project, { objects: {} }, 'Snapback4chat'), /custom Podfile/);

    // Removing the one published plugin must reproduce the unadopted lifecycle.
    fs.rmSync(path.join(project, 'ios'), { recursive: true, force: true });
    const legacy = structuredClone(app);
    legacy.expo.plugins = legacy.expo.plugins.filter(p => p !== 'snapback4-expo/plugin');
    fs.writeFileSync(path.join(project, 'app.json'), JSON.stringify(legacy));
    const control = build();
    assert.equal(control.info.UIApplicationSceneManifest, undefined);
    assert.equal(control.info.UIViewControllerBasedStatusBarAppearance, generated.info.UIViewControllerBasedStatusBarAppearance);
    assert.match(control.delegate, /factory.startReactNative\(/);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});
