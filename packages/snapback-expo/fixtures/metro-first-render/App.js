import React from 'react';
import { Text } from 'react-native';
import { APP_BINDING_FORMAT } from '@expo/snapback-expo/app-binding';

export default function App() {
  return React.createElement(
    Text,
    { testID: 'snapback-expo-first-render' },
    `Snapback Expo first render: ${APP_BINDING_FORMAT}`,
  );
}
