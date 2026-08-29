import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CompatTextInput, domValueForTestId } from './CompatTextInput';
import { palette, radii, spacing, typeScale } from './tokens';

export interface AuthFormProps {
  mode: 'sign-up' | 'sign-in';
  email: string;
  password: string;
  onChangeEmail: (text: string) => void;
  onChangePassword: (text: string) => void;
  /** Submit with the current credentials. All auth logic is the lane's. */
  onSubmit: (email: string, password: string) => void;
  /** Renders the sign-up/sign-in switch line when provided. */
  onToggleMode?: () => void;
  /** Server-side error to surface (duplicate email, bad credentials, …). */
  errorText?: string;
  submitting?: boolean;
  /** Wordmark shown above the form. Default "Clique". */
  appName?: string;
  testID?: string;
}

/**
 * Email + password auth form (brief M1). Purely presentational: no
 * validation beyond what the inputs afford, no session logic; the brief's
 * ≥8-char password rule and duplicate checks are the backend's and
 * surface via `errorText`.
 */
export function AuthForm({
  mode,
  email,
  password,
  onChangeEmail,
  onChangePassword,
  onSubmit,
  onToggleMode,
  errorText,
  submitting = false,
  appName = 'Clique',
  testID = 'sm-auth',
}: AuthFormProps): React.JSX.Element {
  const isSignUp = mode === 'sign-up';
  const submitLabel = isSignUp ? 'Sign up' : 'Sign in';
  const disabled = submitting || email.trim().length === 0 || password.length === 0;
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.wordmark}>{appName}</Text>
      <CompatTextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        onChangeText={onChangeEmail}
        placeholder="Email"
        placeholderTextColor={palette.textFaint}
        style={styles.input}
        testID="sm-auth-email"
        value={email}
      />
      <CompatTextInput
        accessibilityLabel="Password"
        autoCapitalize="none"
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        onChangeText={onChangePassword}
        placeholder="Password"
        placeholderTextColor={palette.textFaint}
        secureTextEntry
        style={styles.input}
        testID="sm-auth-password"
        value={password}
      />
      {errorText ? (
        <Text style={styles.error} testID="sm-auth-error">
          {errorText}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel={submitLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() =>
          onSubmit(
            domValueForTestId('sm-auth-email', email),
            domValueForTestId('sm-auth-password', password),
          )
        }
        style={[styles.submit, disabled && styles.submitDisabled]}
        testID="sm-auth-submit"
      >
        <Text style={styles.submitText}>{submitting ? '…' : submitLabel}</Text>
      </Pressable>
      {onToggleMode ? (
        <Pressable
          accessibilityLabel={isSignUp ? 'Switch to sign in' : 'Switch to sign up'}
          accessibilityRole="button"
          onPress={onToggleMode}
          style={styles.toggle}
          testID="sm-auth-toggle"
        >
          <Text style={styles.toggleText}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <Text style={styles.toggleLink}>{isSignUp ? 'Sign in' : 'Sign up'}</Text>
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    padding: spacing.xl,
  },
  wordmark: {
    ...typeScale.largeTitle,
    color: palette.primary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  input: {
    ...typeScale.body,
    color: palette.text,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  error: {
    ...typeScale.footnote,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  submit: {
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    ...typeScale.body,
    color: palette.textInverse,
    fontWeight: '700',
  },
  toggle: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  toggleText: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
  toggleLink: {
    color: palette.link,
    fontWeight: '600',
  },
});
