import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

export function QueryState({
  message,
  error,
  developerDetails,
}: {
  message: string;
  error?: unknown;
  developerDetails?: { code: string; actions: readonly string[] };
}) {
  const [detailsVisible, setDetailsVisible] = useState(false);
  return <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
    {!error ? <ActivityIndicator color={colors.blue} /> : null}
    <Text selectable style={{ color: error ? '#d92d20' : colors.secondary, textAlign: 'center' }}>{error ? `${message}\n${error instanceof Error ? error.message : String(error)}` : message}</Text>
    {error && developerDetails ? <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsVisible }}
        onPress={() => setDetailsVisible((visible) => !visible)}
        hitSlop={8}
      >
        <Text style={{ color: colors.blue, fontWeight: '600' }}>
          {detailsVisible ? 'Hide developer details' : 'Developer details'}
        </Text>
      </Pressable>
      {detailsVisible ? <View style={{ gap: 6, maxWidth: 520 }}>
        <Text selectable style={{ color: colors.secondary, fontFamily: 'monospace' }}>
          {developerDetails.code}
        </Text>
        {developerDetails.actions.map((action) => <Text
          key={action}
          selectable
          style={{ color: colors.secondary }}
        >
          {'• '}{action}
        </Text>)}
      </View> : null}
    </> : null}
  </View>;
}
