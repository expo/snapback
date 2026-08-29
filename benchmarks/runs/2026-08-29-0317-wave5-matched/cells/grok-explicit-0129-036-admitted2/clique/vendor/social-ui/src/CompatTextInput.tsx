import React from 'react';
import { Platform, TextInput, type TextInputProps } from 'react-native';

function readDomValue(testID: string | undefined): string | undefined {
  if (Platform.OS !== 'web' || !testID || typeof document === 'undefined') return undefined;
  const node = document.querySelector(`[data-testid="${testID}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  return node ? node.value : undefined;
}

/** Playwright fill updates native inputs; RN-web TextInput often does not. */
export function CompatTextInput(props: TextInputProps): React.JSX.Element {
  const {
    testID,
    value,
    onChangeText,
    placeholder,
    maxLength,
    multiline,
    autoCapitalize,
    editable,
    accessibilityLabel,
    onSubmitEditing,
    secureTextEntry,
  } = props;
  if (Platform.OS !== 'web') {
    return <TextInput {...props} />;
  }
  const common = {
    'data-testid': testID,
    'aria-label': accessibilityLabel,
    value: value ?? '',
    maxLength,
    placeholder,
    disabled: editable === false,
    autoCapitalize: autoCapitalize === 'none' ? 'off' : autoCapitalize,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChangeText?.(event.currentTarget.value);
    },
    onInput: (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChangeText?.(event.currentTarget.value);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && onSubmitEditing) {
        event.preventDefault();
        onSubmitEditing({ nativeEvent: { text: event.currentTarget.value } } as never);
      }
    },
    style: {
      width: '100%',
      boxSizing: 'border-box' as const,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      font: 'inherit',
      color: 'inherit',
      padding: 8,
      minHeight: multiline ? 64 : undefined,
    },
  };
  if (multiline) {
    return <textarea {...common} />;
  }
  return (
    <input
      {...common}
      type={secureTextEntry ? 'password' : 'text'}
      autoComplete={secureTextEntry ? 'current-password' : 'off'}
    />
  );
}

export function domValueForTestId(testID: string, fallback: string): string {
  return readDomValue(testID) ?? fallback;
}
