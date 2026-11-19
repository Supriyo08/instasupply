import { describeError } from '@instasupply/expo-firebase';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Header, Icon, Input, Screen, Text } from '@/components/ui';
import { Avatar } from '@/features/account/Avatar';
import { displayPhone, memberSince } from '@/features/account/format';
import { FormSection } from '@/features/account/FormSection';
import { PasswordResetCard } from '@/features/account/PasswordResetCard';
import { cleanDisplayName, updateDisplayName } from '@/features/account/profile-service';
import { useToast } from '@/features/notifications/ToastProvider';
import { useCustomer } from '@/features/session/SessionProvider';
import { notify } from '@/lib/notify';
import { colors } from '@/theme/tokens';

/** "About me": edit the display name; email and verified phone are read-only. */
export default function AboutScreen() {
  const { user, profile } = useCustomer();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = draft ?? profile.displayName;
  const cleaned = cleanDisplayName(name);
  const dirty = draft !== null && cleaned !== profile.displayName;
  const email = profile.email ?? user.email;
  const since = memberSince(profile.createdAt);

  const save = async () => {
    if (!cleaned) {
      setError('Enter your name (at least 2 characters).');
      return;
    }
    if (!dirty) return;
    setSaving(true);
    try {
      await updateDisplayName(user.uid, cleaned);
      setDraft(null);
      toast({ title: 'Profile updated', icon: 'check-circle' });
    } catch (saveError) {
      notify("Couldn't save your profile", describeError(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={<Header title="About me" />}
      footer={<Button label="Save settings" loading={saving} disabled={!dirty} onPress={() => void save()} />}
    >
      <View style={styles.identity}>
        <Avatar name={cleaned ?? profile.displayName} size={88} />
        <Text variant="heading" numberOfLines={1}>
          {profile.displayName}
        </Text>
        {since ? (
          <Text variant="caption" color="muted">
            {since}
          </Text>
        ) : null}
      </View>

      <FormSection title="Personal details">
        <Input
          icon="user"
          placeholder="Full name"
          value={name}
          maxLength={80}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          error={error}
          onChangeText={(value) => {
            setDraft(value);
            setError(null);
          }}
          onSubmitEditing={() => void save()}
        />
        <Input
          icon="mail"
          placeholder="Email"
          value={email ?? 'No email on file'}
          editable={false}
          style={styles.readOnly}
          trailing={<Icon name="lock" size={16} color={colors.textSubtle} />}
        />
        <Input
          icon="phone"
          placeholder="Mobile number"
          value={displayPhone(profile.phoneNumber) || 'Not added'}
          editable={false}
          style={styles.readOnly}
          trailing={profile.phoneVerified ? <Badge label="Verified" style={styles.badge} /> : null}
        />
        <Text variant="caption" color="muted" style={styles.note}>
          Your email and verified mobile number identify your account and can&apos;t be changed here.
        </Text>
      </FormSection>

      <FormSection title="Change password">
        <PasswordResetCard email={email} />
      </FormSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Centred in the field's row (Badge aligns itself to the start by default).
  badge: { alignSelf: 'center' },
  identity: { alignItems: 'center', gap: 4, paddingVertical: 4 },
  note: { paddingHorizontal: 2 },
  readOnly: { color: colors.textMuted },
});
