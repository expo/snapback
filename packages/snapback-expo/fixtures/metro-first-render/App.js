import React from 'react';
import { Text } from 'react-native';
import { APP_BINDING_FORMAT } from '@expo/snapback-expo/app-binding';
import { resolveExpoSharedBrowserModules } from '@expo/snapback-expo/shared-browser-adapter';

export default function App() {
  return React.createElement(
    Text,
    { testID: 'snapback-expo-first-render' },
    `Snapback Expo first render: ${APP_BINDING_FORMAT}; resolver=${typeof resolveExpoSharedBrowserModules}`,
  );
}
