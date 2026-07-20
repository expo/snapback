import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ChatApp } from './src/ChatApp';
import { KeyboardRoot } from './src/keyboard';

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardRoot>
        <StatusBar style="dark" />
        <ChatApp />
      </KeyboardRoot>
    </SafeAreaProvider>
  );
}
