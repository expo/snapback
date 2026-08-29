import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSnapbackCommand, useSnapbackQuery, useSnapbackSettledMutation } from '@expo/snapback-expo';
import { ProfileForm, palette, typeScale } from '@snapback-bench/social-ui';
import type { ProfileFormValues } from '@snapback-bench/social-ui';
import { app } from '../../snapback/generated/app.mjs';
import api from '../../snapback/generated/api.mjs';
import { assetUrl, diagnosticText } from '../../src/lib/snapback';

const EMPTY = {};

export default function EditProfileScreen() {
  const router = useRouter();
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const upsert = useSnapbackSettledMutation(api.upsertProfile);
  const saveProfile = useSnapbackCommand(app.commands.saveProfile);
  const row = mine.data?.[0];
  const [values, setValues] = useState<ProfileFormValues>({
    displayName: '',
    handle: '',
    bio: '',
    location: '',
    link: '',
  });
  const [errorText, setErrorText] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!row || hydrated) return;
    setValues({
      displayName: row.displayName,
      handle: row.handle,
      bio: row.bio,
      location: row.location,
      link: row.link,
    });
    setHydrated(true);
  }, [row, hydrated]);

  const save = async (next: ProfileFormValues) => {
    const handle = (next.handle || row?.handle || values.handle).trim().toLowerCase();
    const displayName = (next.displayName || row?.displayName || values.displayName).trim();
    setSaving(true);
    setErrorText(undefined);
    try {
      if (file) {
        const task = saveProfile({
          displayName,
          handle,
          bio: next.bio,
          location: next.location,
          link: next.link,
          avatar: file,
        });
        const outcome = await task.done;
        if (outcome?.kind === 'failed' || outcome?.kind === 'cancelled' || outcome?.kind === 'ambiguous') {
          throw new Error(outcome.diagnostic?.message ?? `save ${outcome.kind}`);
        }
      } else {
        await upsert({
          displayName,
          handle,
          bio: next.bio,
          location: next.location,
          link: next.link,
        });
      }
      router.push(`/profile/${handle}`);
    } catch (error) {
      const text = diagnosticText(error) ?? 'Could not save profile';
      if (/HANDLE_TAKEN|unique|handle/i.test(text)) setErrorText('That handle is already taken.');
      else setErrorText(text);
    } finally {
      setSaving(false);
    }
  };

  if (!hydrated) {
    return (
      <View style={styles.page}>
        <Text style={styles.loading}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {Platform.OS === 'web' ? (
        <input
          type="file"
          accept="image/*"
          data-testid="sm-profile-file"
          style={{ display: 'none' }}
          onChange={(event) => {
            const next = event.currentTarget.files?.[0];
            if (next) setFile(next);
          }}
        />
      ) : null}
      <ProfileForm
        mode="edit"
        values={values}
        avatarUri={file ? URL.createObjectURL(file) : assetUrl(row?.avatar)}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        onPressSave={(next) => void save(next)}
        onPressAvatar={() => {
          const node = document.querySelector('[data-testid="sm-profile-file"]') as HTMLInputElement | null;
          node?.click();
        }}
        saving={saving}
        errorText={errorText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { ...typeScale.body, color: palette.textMuted, padding: 24 },
});
