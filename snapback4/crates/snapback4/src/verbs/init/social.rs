//! Published starter: every file is embedded in the installed CLI binary.
use serde_json::{Value, json};

// @ref LLP 3000.028#8 — one integrated app carries the three client recipes.
pub(super) fn files() -> Vec<(&'static str, String)> {
    let mut files = super::expo_files();
    files.retain(|(name, _)| matches!(*name, "package.json" | "src/native-smoke.ts" | "babel.config.js" | "metro.config.js" | "metro-wasm-transformer.cjs" | "src/intent-store.ts" | "src/intent-store.web.ts" | "src/intent-store.native.ts"));
    let package = files.iter_mut().find(|(name, _)| *name == "package.json").unwrap();
    let mut value: Value = serde_json::from_str(&package.1).unwrap();
    value["name"] = json!("snapback4-social-starter");
    value["main"] = json!("expo-router/entry");
    for (name, version) in [("expo-router", "~57.0.21"), ("expo-image-picker", "~57.0.17"), ("expo-linking", "~57.0.10"), ("react-native-screens", "~4.26.0"), ("react-native-safe-area-context", "~5.7.0")] {
        value["dependencies"][name] = json!(version);
    }
    value["scripts"]["web"] = json!("expo start --web");
    package.1 = super::pretty(&value);
    files.extend([
        ("scripts/seed.mjs", include_str!("social/seed.mjs").to_owned()),
        ("snapback/workers/notifications.mjs", include_str!("social/notifications.mjs").to_owned()),
        ("snapback/schema.q", include_str!("social/schema.q").to_owned()),
        ("README.md", include_str!("social/README.md").to_owned()),
        ("src/intents.ts", include_str!("social/intents.ts").to_owned()),
        ("src/client.ts", include_str!("social/client.ts").to_owned()),
        ("src/TrendingSnapshot.tsx", include_str!("social/TrendingSnapshot.tsx").to_owned()),
        ("src/useTyping.ts", include_str!("social/useTyping.ts").to_owned()),
        ("src/useOnceMedia.ts", include_str!("social/useOnceMedia.ts").to_owned()),
        ("src/Conversation.tsx", include_str!("social/Conversation.tsx").to_owned()),
        ("src/QuotedMessage.tsx", include_str!("social/QuotedMessage.tsx").to_owned()),
        ("src/BoundedConversation.tsx", include_str!("social/BoundedConversation.tsx").to_owned()),
        ("src/PageLifetime.ts", include_str!("social/PageLifetime.ts").to_owned()),
        ("src/ui.tsx", include_str!("social/ui.tsx").to_owned()),
        ("src/Feed.tsx", include_str!("social/Feed.tsx").to_owned()),
        ("src/Chats.tsx", include_str!("social/Chats.tsx").to_owned()),
        ("src/Search.tsx", include_str!("social/Search.tsx").to_owned()),
        ("src/Profile.tsx", include_str!("social/Profile.tsx").to_owned()),
        ("src/Direct.tsx", include_str!("social/Direct.tsx").to_owned()),
        ("app/_layout.tsx", include_str!("social/layout.tsx").to_owned()),
        ("app/conversation/[id].tsx", include_str!("social/conversation-route.tsx").to_owned()),
        ("app/dm/[other].tsx", "import { useLocalSearchParams } from 'expo-router';\nimport Direct from '../../src/Direct';\nexport default function DirectRoute() { const { other } = useLocalSearchParams<{ other: string }>(); return <Direct other={other} />; }\n".to_owned()),
        ("app/(tabs)/_layout.tsx", "import { Tabs } from 'expo-router';\nexport default function Layout() { return <Tabs><Tabs.Screen name=\"index\" options={{ title: 'Following' }} /><Tabs.Screen name=\"chats\" options={{ title: 'Chats' }} /><Tabs.Screen name=\"search\" options={{ title: 'Search' }} /><Tabs.Screen name=\"profile\" options={{ title: 'Profile' }} /></Tabs>; }\n".to_owned()),
        ("app/(tabs)/index.tsx", "export { default } from '../../src/Feed';\n".to_owned()),
        ("app/(tabs)/chats.tsx", "export { default } from '../../src/Chats';\n".to_owned()),
        ("app/(tabs)/search.tsx", "export { default } from '../../src/Search';\n".to_owned()),
        ("app/(tabs)/profile.tsx", "export { default } from '../../src/Profile';\n".to_owned()),
        ("app/search-chat/[id].tsx", "import { useLocalSearchParams } from 'expo-router';\nimport Search from '../../src/Search';\nexport default function ChatSearch() { const { id } = useLocalSearchParams<{ id: string }>(); return <Search key={id} conversation={id} />; }\n".to_owned()),
        ("tsconfig.json", super::pretty(&json!({ "extends": "expo/tsconfig.base", "compilerOptions": { "strict": true, "jsx": "react-jsx", "moduleResolution": "bundler", "module": "esnext", "allowImportingTsExtensions": true, "noEmit": true, "skipLibCheck": true }, "include": ["app/**/*.tsx", "src/**/*", "snapback/generated/api.ts"] }))),
        ("app.json", super::pretty(&json!({ "expo": { "name": "Small social", "slug": "small-social", "scheme": "smallsocial", "newArchEnabled": true, "ios": { "bundleIdentifier": "dev.snapback4.social" }, "android": { "package": "dev.snapback4.social" }, "web": { "bundler": "metro" }, "plugins": ["expo-router", "expo-sqlite", "expo-secure-store", "expo-image-picker", "snapback4-expo/plugin"] } }))),
    ]);
    files
}
