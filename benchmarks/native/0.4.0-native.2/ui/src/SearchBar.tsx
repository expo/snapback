import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from './Avatar';
import { palette, radii, spacing, typeScale } from './tokens';

export interface SearchResultItem {
  /** Opaque stable key, echoed back through onPressResult. */
  id: string;
  /** Primary line: display name, or the matched message excerpt. */
  title: string;
  /** Secondary line: handle, sender, or a pre-formatted context string. */
  subtitle?: string;
  avatarUri?: string;
  /**
   * Group header (e.g. the chat name for all-messages search, which the
   * brief groups by chat). Consecutive items sharing a groupLabel render
   * under one header. Ungrouped results omit it.
   */
  groupLabel?: string;
}

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Submit via keyboard search key. */
  onSubmit?: () => void;
  /** Renders a ✕ clear affordance when provided and value is non-empty. */
  onClear?: () => void;
  /**
   * Flat, already-ordered results (newest first per the brief; ordering
   * and pagination are the lane's job). Omit to render the input alone.
   */
  results?: readonly SearchResultItem[];
  onPressResult?: (id: string) => void;
  loading?: boolean;
  /** Shown when value is non-empty and results is an empty array. */
  emptyText?: string;
  /** Contract testID for the input. Default `sm-search-input`. */
  testID?: string;
}

/**
 * Search input plus an optional plain results list (brief M5's three
 * scopes: people / this chat / all messages). The kit renders whatever
 * results it is handed; matching semantics, scoping, grouping order, and
 * pagination live in the lane. Rows carry `sm-search-result`.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmit,
  onClear,
  results,
  onPressResult,
  loading = false,
  emptyText = 'No results',
  testID = 'sm-search-input',
}: SearchBarProps): React.JSX.Element {
  let lastGroup: string | undefined;
  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <Text style={styles.icon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search"
          autoCapitalize="none"
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          returnKeyType="search"
          style={styles.input}
          testID={testID}
          value={value}
        />
        {onClear && value.length > 0 ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={spacing.sm}
            onPress={onClear}
            testID="sm-search-clear"
          >
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <Text style={styles.status} testID="sm-search-loading">
          Searching…
        </Text>
      ) : null}
      {!loading && results && results.length === 0 && value.length > 0 ? (
        <Text style={styles.status} testID="sm-search-empty">
          {emptyText}
        </Text>
      ) : null}
      {!loading && results
        ? results.map((item, index) => {
            const header =
              item.groupLabel != null && item.groupLabel !== lastGroup ? (
                <Text key={`group-${index}`} style={styles.groupHeader} testID="sm-search-group">
                  {item.groupLabel}
                </Text>
              ) : null;
            lastGroup = item.groupLabel;
            return (
              <React.Fragment key={item.id}>
                {header}
                <Pressable
                  accessibilityLabel={`Result: ${item.title}`}
                  accessibilityValue={{ text: item.id }}
                  aria-valuetext={item.id}
                  accessibilityRole="button"
                  onPress={onPressResult ? () => onPressResult(item.id) : undefined}
                  style={styles.resultRow}
                  testID="sm-search-result"
                >
                  {item.avatarUri != null || item.subtitle != null ? (
                    <Avatar
                      label={item.title}
                      size={36}
                      {...(item.avatarUri ? { uri: item.avatarUri } : {})}
                    />
                  ) : null}
                  <View style={styles.resultBody}>
                    <Text numberOfLines={1} style={styles.resultTitle}>
                      {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text numberOfLines={1} style={styles.resultSubtitle}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              </React.Fragment>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  icon: {
    fontSize: 16,
    color: palette.textMuted,
    marginRight: spacing.sm,
  },
  input: {
    ...typeScale.body,
    flex: 1,
    color: palette.text,
    paddingVertical: spacing.sm,
  },
  clear: {
    fontSize: 14,
    color: palette.textMuted,
    paddingHorizontal: spacing.xs,
  },
  status: {
    ...typeScale.footnote,
    color: palette.textMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  groupHeader: {
    ...typeScale.footnote,
    fontWeight: '700',
    color: palette.textMuted,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    textTransform: 'uppercase',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  resultBody: {
    flex: 1,
    marginLeft: spacing.md,
  },
  resultTitle: {
    ...typeScale.body,
    color: palette.text,
  },
  resultSubtitle: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
});
