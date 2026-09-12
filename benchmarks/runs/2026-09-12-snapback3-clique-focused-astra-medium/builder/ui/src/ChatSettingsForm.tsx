import React from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from './Avatar';
import { chatAccentList, ChatAccent, palette, radii, spacing, typeScale } from './tokens';
import { webSourceUriProps } from './webSemantics';

export type DisappearingSetting = 'off' | '24h' | '7d';

export interface ChatMemberItem {
  id: string;
  name: string;
  avatarUri?: string;
  admin?: boolean;
}

export interface ChatSettingsFormProps {
  /** Group chat (name/description/members) vs DM (color + background only). */
  isGroup: boolean;
  /**
   * Whether the viewer may edit admin-gated settings (brief M3/M5: group
   * name/description/membership/disappearing are admin-only in groups;
   * in DMs both members may edit). Enforcement is server-side — this
   * flag only shows/hides affordances.
   */
  canEdit: boolean;
  /** Group name (groups only). */
  name?: string;
  onChangeName?: (text: string) => void;
  /** Group description (groups only, ≤200). */
  description?: string;
  onChangeDescription?: (text: string) => void;
  /** Accent palette to offer. Default: the kit's pinned 8 (tokens.chatAccentList). */
  accentColors?: readonly ChatAccent[];
  /** Currently selected accent color value (hex). */
  selectedAccentColor?: string;
  /** Tap a swatch (`sm-chatsettings-color`). Sync-to-members is the lane's. */
  onSelectAccentColor: (color: ChatAccent) => void;
  /** Current background image URI, if set. */
  backgroundUri?: string;
  /** Tap the background row (`sm-chatsettings-background`) → pick a fixture image. */
  onPressBackground: () => void;
  /** Disappearing-messages setting (brief M5). Renders when onSelectDisappearing given. */
  disappearing?: DisappearingSetting;
  onSelectDisappearing?: (setting: DisappearingSetting) => void;
  /** Backfilled conversation message count (brief M7); renders when provided. */
  messageCount?: number;
  /** Group members (groups only). */
  members?: readonly ChatMemberItem[];
  onPressMember?: (id: string) => void;
  /** Admin actions; affordances render only when canEdit and the callback exist. */
  onRemoveMember?: (id: string) => void;
  onPromoteMember?: (id: string) => void;
  onPressAddMember?: () => void;
  /** Optional structurally-addressable candidates for an inline add-member control. */
  addableMembers?: readonly ChatMemberItem[];
  onAddMember?: (id: string) => void;
  onPressLeave?: () => void;
  /** Server-side rejection to surface (e.g. non-admin rename refused). */
  errorText?: string;
  testID?: string;
}

const DISAPPEARING_OPTIONS: readonly { value: DisappearingSetting; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

/**
 * Chat settings surface (brief M3/M5/M7): group identity, the pinned
 * 8-accent palette, background image, disappearing setting, message
 * count, and the member roster with admin affordances. All persistence,
 * sync, and permission enforcement live in the lane/backend.
 */
// @ref LLP 0201#d6--ui-kit — expose observable state through neutral
// presentation/accessibility props without introducing a backend-shaped API.
export function ChatSettingsForm({
  isGroup,
  canEdit,
  name,
  onChangeName,
  description,
  onChangeDescription,
  accentColors = chatAccentList,
  selectedAccentColor,
  onSelectAccentColor,
  backgroundUri,
  onPressBackground,
  disappearing,
  onSelectDisappearing,
  messageCount,
  members,
  onPressMember,
  onRemoveMember,
  onPromoteMember,
  onPressAddMember,
  addableMembers,
  onAddMember,
  onPressLeave,
  errorText,
  testID = 'sm-chatsettings',
}: ChatSettingsFormProps): React.JSX.Element {
  return (
    <View style={styles.container} testID={testID}>
      {isGroup ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Group name</Text>
          <TextInput
            accessibilityLabel="Group name"
            editable={canEdit}
            maxLength={50}
            onChangeText={onChangeName}
            style={[styles.input, !canEdit && styles.inputDisabled]}
            testID="sm-chatsettings-name"
            value={name ?? ''}
          />
          <Text style={styles.sectionLabel}>Description</Text>
          <TextInput
            accessibilityLabel="Group description"
            editable={canEdit}
            maxLength={200}
            multiline
            onChangeText={onChangeDescription}
            style={[styles.input, styles.inputMultiline, !canEdit && styles.inputDisabled]}
            testID="sm-chatsettings-description"
            value={description ?? ''}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Accent color</Text>
        <View style={styles.swatchRow}>
          {accentColors.map((accent) => {
            const selected = accent.value === selectedAccentColor;
            return (
              <Pressable
                accessibilityLabel={`Accent color ${accent.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityValue={{ text: accent.value }}
                aria-pressed={selected}
                aria-valuetext={accent.value}
                key={accent.name}
                onPress={() => onSelectAccentColor(accent)}
                style={[
                  styles.swatch,
                  { backgroundColor: accent.value },
                  selected && styles.swatchSelected,
                ]}
                testID="sm-chatsettings-color"
              >
                {selected ? <Text style={styles.swatchCheck}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Background</Text>
        <Pressable
          accessibilityLabel="Chat background image"
          accessibilityRole="button"
          onPress={onPressBackground}
          style={styles.backgroundRow}
          testID="sm-chatsettings-background"
        >
          {backgroundUri ? (
            <Image
              {...webSourceUriProps(backgroundUri)}
              source={{ uri: backgroundUri }}
              style={styles.backgroundThumb}
              testID="sm-chatsettings-background-preview"
            />
          ) : (
            <View
              style={[styles.backgroundThumb, styles.backgroundThumbEmpty]}
              testID="sm-chatsettings-background-preview"
            />
          )}
          <Text style={styles.backgroundLabel}>
            {backgroundUri ? 'Change background' : 'Choose background'}
          </Text>
        </Pressable>
      </View>

      {onSelectDisappearing ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Disappearing messages</Text>
          <View style={styles.segmentRow}>
            {DISAPPEARING_OPTIONS.map(({ value, label }) => {
              const selected = value === (disappearing ?? 'off');
              return (
                <Pressable
                  accessibilityLabel={`Disappearing messages ${label}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: !canEdit }}
                  accessibilityValue={{ text: value }}
                  aria-pressed={selected}
                  aria-valuetext={value}
                  disabled={!canEdit}
                  key={value}
                  onPress={() => onSelectDisappearing(value)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  testID="sm-chatsettings-disappearing"
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {messageCount != null ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Messages</Text>
          <Text style={styles.messageCount} testID="sm-chatsettings-messagecount">
            {messageCount}
          </Text>
        </View>
      ) : null}

      {isGroup && members ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </Text>
          {members.map((member) => (
            <View
              accessibilityLabel={`Member ${member.name}`}
              accessibilityValue={{ text: `${member.id}:${member.admin ? 'admin' : 'member'}` }}
              aria-valuetext={`${member.id}:${member.admin ? 'admin' : 'member'}`}
              key={member.id}
              style={styles.memberRow}
              testID="sm-chatsettings-member"
            >
              <Pressable
                accessibilityLabel={`Member ${member.name}`}
                accessibilityRole="button"
                onPress={onPressMember ? () => onPressMember(member.id) : undefined}
                style={styles.memberMain}
              >
                <Avatar label={member.name} size={36} {...(member.avatarUri ? { uri: member.avatarUri } : {})} />
                <Text numberOfLines={1} style={styles.memberName}>
                  {member.name}
                </Text>
                {member.admin ? <Text style={styles.adminBadge}>admin</Text> : null}
              </Pressable>
              {canEdit && !member.admin && onPromoteMember ? (
                <Pressable
                  accessibilityLabel={`Make ${member.name} admin`}
                  accessibilityRole="button"
                  onPress={() => onPromoteMember(member.id)}
                  style={styles.memberAction}
                  testID="sm-chatsettings-member-promote"
                >
                  <Text style={styles.memberActionText}>Make admin</Text>
                </Pressable>
              ) : null}
              {canEdit && onRemoveMember ? (
                <Pressable
                  accessibilityLabel={`Remove ${member.name}`}
                  accessibilityRole="button"
                  onPress={() => onRemoveMember(member.id)}
                  style={styles.memberAction}
                  testID="sm-chatsettings-member-remove"
                >
                  <Text style={[styles.memberActionText, styles.destructiveText]}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {canEdit && onPressAddMember ? (
            <Pressable
              accessibilityLabel="Add member"
              accessibilityRole="button"
              onPress={onPressAddMember}
              style={styles.addMember}
              testID="sm-chatsettings-member-add"
            >
              <Text style={styles.addMemberText}>＋ Add member</Text>
            </Pressable>
          ) : null}
          {canEdit && onAddMember && addableMembers && addableMembers.length > 0 ? (
            <View style={styles.addCandidates}>
              {addableMembers.map((member) => (
                <Pressable
                  accessibilityLabel={`Add ${member.name}`}
                  accessibilityRole="button"
                  accessibilityValue={{ text: member.id }}
                  aria-valuetext={member.id}
                  key={member.id}
                  onPress={() => onAddMember(member.id)}
                  style={styles.addMember}
                  testID="sm-chatsettings-member-candidate"
                >
                  <Text style={styles.addMemberText}>＋ {member.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {errorText ? (
        <Text style={styles.error} testID="sm-chatsettings-error">
          {errorText}
        </Text>
      ) : null}

      {onPressLeave ? (
        <Pressable
          accessibilityLabel={isGroup ? 'Leave group' : 'Leave conversation'}
          accessibilityRole="button"
          onPress={onPressLeave}
          style={styles.leave}
          testID="sm-chatsettings-leave"
        >
          <Text style={styles.destructiveText}>{isGroup ? 'Leave group' : 'Leave conversation'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    ...typeScale.footnote,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  input: {
    ...typeScale.body,
    color: palette.text,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  inputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    color: palette.textMuted,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: palette.text,
  },
  swatchCheck: {
    color: palette.textInverse,
    fontWeight: '700',
  },
  backgroundRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backgroundThumb: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceStrong,
  },
  backgroundThumbEmpty: {
    borderColor: palette.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: palette.surface,
  },
  backgroundLabel: {
    ...typeScale.body,
    color: palette.link,
    marginLeft: spacing.md,
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  segmentSelected: {
    backgroundColor: palette.background,
  },
  segmentText: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
  segmentTextSelected: {
    color: palette.text,
    fontWeight: '600',
  },
  messageCount: {
    ...typeScale.title,
    color: palette.text,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  memberMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberName: {
    ...typeScale.body,
    color: palette.text,
    marginLeft: spacing.md,
    flexShrink: 1,
  },
  adminBadge: {
    ...typeScale.caption,
    color: palette.primary,
    borderColor: palette.primary,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    marginLeft: spacing.sm,
  },
  memberAction: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  memberActionText: {
    ...typeScale.footnote,
    color: palette.link,
  },
  addMember: {
    paddingVertical: spacing.sm,
  },
  addCandidates: {
    gap: spacing.xs,
  },
  addMemberText: {
    ...typeScale.body,
    color: palette.link,
  },
  destructiveText: {
    ...typeScale.body,
    color: palette.danger,
  },
  error: {
    ...typeScale.footnote,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  leave: {
    paddingVertical: spacing.md,
  },
});
