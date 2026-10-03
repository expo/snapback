# Native effects omitted by Expo introspection

The effective-config path is Expo 57.0.22's `getPrebuildConfigAsync` followed by `compileModsAsync({platforms:['ios'], introspect:true, ignoreExistingNativeFiles:true})`. Its `mod-compiler.js` explicitly removes non-introspective providers. The installed fingerprint 0.20.13 `ExpoConfigLoader.js` calls `expo/config.getConfig` without this prebuild/mod path, so it alone does not cover the requested effective configuration.

`native-mods.json` permits the actual registered stock callbacks only when every package on their registration call path matches its audited shipped-tree digest. Unknown callbacks (including nominally introspective callbacks that might write other files), changed package trees and direct untracked assignments to `config.mods` retain application JS and the sanitized native environment. No `require()` parsing or declared-plugin-name allowlist remains. The allowlist additionally requires the complete installed starter dependency snapshot (`dependency-audit.json`), reusing the native fingerprint inventory. A changed external helper therefore revokes that audit even if it never appears in a registration stack; no transitive resolver is reconstructed. Package trees are conservative byte checks, not a reconstruction of Expo's resolution; Expo performs that resolution at evaluation time.

The initial per-starter effective-config records retain each actual mod, package version, package tree digest and registration path. Both stock npm starters have no unknown registrations. They contain these non-introspective native effects:

| Registered writer | Inputs and effects audited |
|---|---|
| Expo default icon `dangerous` / `xcodeproj` mods (`@expo/prebuild-config`) | `icon` / `ios.icon` config and named resource bytes; create the asset catalog and Xcode icon references. No application module input. |
| Expo default Xcode mods (`@expo/config-plugins`) | Bundle ID, product name, deployment target, device family, bitcode, development team, locales and Google service config. Named in-tree resources are separately hashed; external paths refuse. |
| Expo Maps legacy `podfile` / `appDelegate` fallbacks | Config API key and presence of the installed native Maps package, plus the generated native template. Maps is absent in these starters; the fallback removes legacy template integration. Existing native projects retain JS. |
| `snapback4-expo/plugin` `appDelegate` | Fixed Swift scene lifecycle template, with a strict expected-template match. Its paired Info.plist result is also evaluated and fingerprinted. |
| `expo-dev-launcher` `xcodeproj` | Fixed Release build phase removing the development launcher's own local-network plist entries, using the native target derived from config. |
| `expo-router` `podfile` (social only) | Fixed `RNS_GAMMA_ENABLED` Podfile setting; the paired Info.plist activity type is evaluated. |

SecureStore, SQLite, FileSystem, image-picker and dev-client's other iOS registrations have introspected plist/entitlement/Podfile-properties results. Their registered callbacks still pass the conservative known-callback check. Unknown dangerous-mod controls deliberately register a no-op dangerous mod: an application JS edit must nevertheless rebuild, because introspection cannot establish that mod's effects.

This is the bounded starter adapter, not a general plugin sandbox. Native inputs/dependencies and generated output continue to be inventoried and validated. The report records both stock warm costs and the measured unknown-mod rebuild cost.

Primary documentation consulted: [Expo Fingerprint](https://docs.expo.dev/versions/latest/sdk/fingerprint/) and [Expo mods](https://docs.expo.dev/config-plugins/mods/); the decision is based on the installed pinned implementations above, not latest documentation alone.
