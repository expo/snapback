// Keyboard-handling seam. react-native-keyboard-controller drives layout
// synchronously from the native keyboard animation (the "perfect" path; Expo
// Go bundles its native module). If the module is unavailable (e.g. web, or a
// stripped Go build) we fall back to React Native's timer-based
// KeyboardAvoidingView so the app still works — just less buttery.

import React from 'react';
import { KeyboardAvoidingView as RNKeyboardAvoidingView, Platform, View } from 'react-native';

type AvoidingProps = {
  children: React.ReactNode;
  style?: object;
  /** Height of any header rendered above the avoiding region. */
  keyboardVerticalOffset?: number;
};

let controllerAvailable = false;
let ControllerProvider: React.ComponentType<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
let ControllerAvoidingView: React.ComponentType<AvoidingProps> | null = null;

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const controller = require('react-native-keyboard-controller');
    ControllerProvider = controller.KeyboardProvider;
    ControllerAvoidingView = controller.KeyboardAvoidingView;
    controllerAvailable = true;
  } catch {
    controllerAvailable = false;
  }
}

export const keyboardEngine = controllerAvailable ? 'keyboard-controller' : Platform.OS === 'web' ? 'web' : 'rn-fallback';

export function KeyboardRoot({ children }: { children: React.ReactNode }) {
  const Provider = ControllerProvider;
  return <Provider>{children}</Provider>;
}

export function KeyboardAvoiding({ children, style, keyboardVerticalOffset = 0 }: AvoidingProps) {
  if (ControllerAvoidingView) {
    const Avoiding = ControllerAvoidingView;
    return (
      <Avoiding style={style} keyboardVerticalOffset={keyboardVerticalOffset} {...{ behavior: 'padding' }}>
        {children}
      </Avoiding>
    );
  }
  if (Platform.OS === 'web') return <View style={style}>{children}</View>;
  return (
    <RNKeyboardAvoidingView
      style={style}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {children}
    </RNKeyboardAvoidingView>
  );
}
