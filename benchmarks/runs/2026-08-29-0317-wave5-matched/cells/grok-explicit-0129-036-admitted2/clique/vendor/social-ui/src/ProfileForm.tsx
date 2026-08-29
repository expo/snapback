import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { CompatTextInput, domValueForTestId } from './CompatTextInput';
import { renderLinkifiedText } from './linkify';
import { palette, radii, spacing, typeScale } from './tokens';

/** The brief's exact profile fields (M1), minus the avatar image. */
export interface ProfileFormValues {
  displayName: string;
  handle: string;
  bio: string;
  location: string;
  link: string;
}

interface ProfileViewBase {
  displayName: string;
  /** Handle without the leading @. */
  handle: string;
  avatarUri?: string;
  bio?: string;
  location?: string;
  link?: string;
  followerCount: number;
  followingCount: number;
  /** Tap the profile's link URL (e.g. Linking.openURL). */
  onPressLink?: (url: string) => void;
  /** Return to the feed from a profile without relying on screen folklore. */
  onPressFeed?: () => void;
  testID?: string;
}

export interface ProfileFormViewOwnProps extends ProfileViewBase {
  mode: 'view-own';
  /** Tap the Edit button (`sm-profile-edit`). */
  onPressEdit: () => void;
}

export interface ProfileFormViewOtherProps extends ProfileViewBase {
  mode: 'view-other';
  /** Whether the viewer currently follows this user. */
  following: boolean;
  /** Tap the follow toggle (`sm-profile-follow`). Set/clear intent is the lane's. */
  onPressFollow: () => void;
}

export interface ProfileFormEditProps {
  mode: 'edit';
  values: ProfileFormValues;
  avatarUri?: string;
  /** Field change; the lane owns the form state. */
  onChange: (patch: Partial<ProfileFormValues>) => void;
  /** Tap the avatar → pick a replacement image (fixture asset; lane's picker). */
  onPressAvatar?: () => void;
  /** Tap Save (`sm-profile-save`) with the current values. */
  onPressSave: (values: ProfileFormValues) => void;
  saving?: boolean;
  /** Server-side validation error to surface (e.g. duplicate handle). */
  errorText?: string;
  testID?: string;
}

export type ProfileFormProps =
  | ProfileFormViewOwnProps
  | ProfileFormViewOtherProps
  | ProfileFormEditProps;

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  testID: string;
}

function Field({
  label,
  value,
  onChangeText,
  maxLength,
  autoCapitalize = 'sentences',
  multiline = false,
  testID,
}: FieldProps): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <CompatTextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
        testID={testID}
        value={value}
        {...(maxLength != null ? { maxLength } : {})}
      />
    </View>
  );
}

function EditForm(props: ProfileFormEditProps): React.JSX.Element {
  const { values, avatarUri, onChange, onPressAvatar, onPressSave, saving = false, errorText, testID = 'sm-profile-form' } = props;
  return (
    <View style={styles.container} testID={testID}>
      <Pressable
        accessibilityLabel="Change avatar"
        accessibilityRole="button"
        onPress={onPressAvatar}
        style={styles.editAvatar}
        testID="sm-profile-avatar"
      >
        <Avatar label={values.displayName || '?'} size={72} {...(avatarUri ? { uri: avatarUri } : {})} />
        <Text style={styles.editAvatarHint}>Change photo</Text>
      </Pressable>
      <Field
        label="Display name"
        maxLength={50}
        onChangeText={(displayName) => onChange({ displayName })}
        testID="sm-profile-field-displayname"
        value={values.displayName}
      />
      <Field
        autoCapitalize="none"
        label="Handle"
        maxLength={20}
        onChangeText={(handle) => onChange({ handle })}
        testID="sm-profile-field-handle"
        value={values.handle}
      />
      <Field
        label="Bio"
        maxLength={200}
        multiline
        onChangeText={(bio) => onChange({ bio })}
        testID="sm-profile-field-bio"
        value={values.bio}
      />
      <Field
        label="Location"
        maxLength={50}
        onChangeText={(location) => onChange({ location })}
        testID="sm-profile-field-location"
        value={values.location}
      />
      <Field
        autoCapitalize="none"
        label="Link"
        onChangeText={(link) => onChange({ link })}
        testID="sm-profile-field-link"
        value={values.link}
      />
      {errorText ? (
        <Text style={styles.error} testID="sm-profile-error">
          {errorText}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Save profile"
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() =>
          onPressSave({
            displayName: domValueForTestId('sm-profile-field-displayname', values.displayName),
            handle: domValueForTestId('sm-profile-field-handle', values.handle),
            bio: domValueForTestId('sm-profile-field-bio', values.bio),
            location: domValueForTestId('sm-profile-field-location', values.location),
            link: domValueForTestId('sm-profile-field-link', values.link),
          })
        }
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        testID="sm-profile-save"
      >
        <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </View>
  );
}

function ViewProfile(
  props: ProfileFormViewOwnProps | ProfileFormViewOtherProps,
): React.JSX.Element {
  const {
    displayName,
    handle,
    avatarUri,
    bio,
    location,
    link,
    followerCount,
    followingCount,
    onPressLink,
    onPressFeed,
    testID = 'sm-profile',
  } = props;
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.headerRow}>
        <Avatar label={displayName} size={72} {...(avatarUri ? { uri: avatarUri } : {})} />
        <View style={styles.headerAction}>
          {props.mode === 'view-own' ? (
            <Pressable
              accessibilityLabel="Edit profile"
              accessibilityRole="button"
              onPress={props.onPressEdit}
              style={styles.secondaryButton}
              testID="sm-profile-edit"
            >
              <Text style={styles.secondaryButtonText}>Edit profile</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel={props.following ? 'Unfollow' : 'Follow'}
              accessibilityRole="button"
              accessibilityState={{ selected: props.following }}
              onPress={props.onPressFollow}
              style={props.following ? styles.secondaryButton : styles.primaryButtonSmall}
              testID="sm-profile-follow"
            >
              <Text
                style={props.following ? styles.secondaryButtonText : styles.primaryButtonText}
              >
                {props.following ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.displayName} testID="sm-profile-heading">
        {displayName}
      </Text>
      <Text style={styles.handle}>@{handle}</Text>
      {bio ? <Text style={styles.bio}>{renderLinkifiedText(bio, onPressLink)}</Text> : null}
      <View style={styles.metaRow}>
        {location ? <Text style={styles.meta}>◦ {location}</Text> : null}
        {link ? (
          <Text
            accessibilityRole="link"
            onPress={onPressLink ? () => onPressLink(link) : undefined}
            style={styles.metaLink}
            testID="sm-profile-link"
          >
            {link}
          </Text>
        ) : null}
      </View>
      <View style={styles.countsRow}>
        <Text style={styles.count} testID="sm-profile-follower-count">
          <Text style={styles.countNumber}>{followerCount}</Text> Followers
        </Text>
        <Text style={styles.count} testID="sm-profile-following-count">
          <Text style={styles.countNumber}>{followingCount}</Text> Following
        </Text>
      </View>
      {onPressFeed ? (
        <Pressable
          accessibilityLabel="Back to feed"
          accessibilityRole="button"
          onPress={onPressFeed}
          style={styles.feedNavigation}
          testID="sm-profile-nav-feed"
        >
          <Text style={styles.feedNavigationText}>Back to feed</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Profile surface (brief M1/M2), three modes: `view-own` (Edit button),
 * `view-other` (Follow toggle + counts), `edit` (the exact M1 field set
 * with the brief's length caps). The lane owns all state and validation;
 * server-side errors surface via `errorText`.
 */
export function ProfileForm(props: ProfileFormProps): React.JSX.Element {
  if (props.mode === 'edit') {
    return <EditForm {...props} />;
  }
  return <ViewProfile {...props} />;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerAction: {
    alignSelf: 'flex-start',
  },
  displayName: {
    ...typeScale.title,
    color: palette.text,
    marginTop: spacing.md,
  },
  handle: {
    ...typeScale.body,
    color: palette.textMuted,
  },
  bio: {
    ...typeScale.body,
    color: palette.text,
    marginTop: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    marginTop: spacing.xs,
  },
  meta: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
  metaLink: {
    ...typeScale.footnote,
    color: palette.link,
    textDecorationLine: 'underline',
  },
  countsRow: {
    flexDirection: 'row',
    columnGap: spacing.lg,
    marginTop: spacing.md,
  },
  count: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
  countNumber: {
    color: palette.text,
    fontWeight: '700',
  },
  feedNavigation: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  feedNavigationText: {
    ...typeScale.footnote,
    color: palette.link,
  },
  editAvatar: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  editAvatarHint: {
    ...typeScale.footnote,
    color: palette.link,
    marginTop: spacing.xs,
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typeScale.footnote,
    color: palette.textMuted,
    marginBottom: spacing.xs,
  },
  fieldInput: {
    ...typeScale.body,
    color: palette.text,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fieldInputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  error: {
    ...typeScale.footnote,
    color: palette.danger,
    marginBottom: spacing.sm,
  },
  primaryButton: {
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  primaryButtonSmall: {
    backgroundColor: palette.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: {
    ...typeScale.body,
    color: palette.textInverse,
    fontWeight: '600',
  },
  secondaryButton: {
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    ...typeScale.body,
    color: palette.text,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
