import { describeError, validateUpload } from '@instasupply/api-client';
import { cleanText, type AccountType, type UserProfile } from '@instasupply/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Input, Notice, Sheet, Text } from '@/components/ui';
import { useToast } from '@/features/notifications/ToastProvider';
import { pickPhotos } from '@/features/uploads/pick';
import { api } from '@/lib/api';
import { spacing } from '@/theme/tokens';

import { cleanDisplayName, updateProfile } from './profile-service';
import { ACCOUNT_TYPE_LABEL } from './ProfileHero';

const TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];

/** Edit name, company, "I'm a…" and the profile photo (`api.session.updateProfile`, avatar upload). */
export function EditProfileSheet({
  visible,
  profile,
  onClose,
}: {
  visible: boolean;
  profile: UserProfile;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const [company, setCompany] = useState(profile.companyName ?? '');
  const [type, setType] = useState<AccountType | null>(profile.accountType ?? null);
  const [busy, setBusy] = useState<'save' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start from the saved profile each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setName(profile.displayName);
    setCompany(profile.companyName ?? '');
    setType(profile.accountType ?? null);
    setError(null);
  }, [visible, profile.displayName, profile.companyName, profile.accountType]);

  const save = async () => {
    const displayName = cleanDisplayName(name);
    if (!displayName) return setError('Enter your name (2 to 80 characters).');
    setBusy('save');
    setError(null);
    try {
      await updateProfile({ displayName, companyName: cleanText(company, 120), accountType: type });
      toast({ title: 'Profile saved', icon: 'check' });
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  const changePhoto = async () => {
    const picked = await pickPhotos({ max: 1 });
    if (picked.status === 'denied') return setError(picked.message);
    const source = picked.status === 'picked' ? picked.sources[0] : undefined;
    if (!source) return;
    const invalid = validateUpload('avatar', source);
    if (invalid) return setError(invalid);
    setBusy('photo');
    setError(null);
    try {
      const uploaded = await api.upload({ purpose: 'avatar', ownerId: profile.uid, source });
      await updateProfile({ photoPath: uploaded.path });
      toast({ title: 'Photo updated', icon: 'image' });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  const removePhoto = async () => {
    setBusy('photo');
    setError(null);
    try {
      await updateProfile({ photoPath: null });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={() => (busy ? undefined : onClose())} title="Edit profile">
      <View style={styles.row}>
        <Button
          label={profile.photoURL ? 'Change photo' : 'Add a photo'}
          icon="camera"
          variant="secondary"
          size="md"
          loading={busy === 'photo'}
          disabled={busy === 'save'}
          style={styles.flex}
          onPress={() => void changePhoto()}
        />
        {profile.photoURL ? (
          <Button
            label="Remove"
            variant="ghost"
            size="md"
            disabled={busy !== null}
            style={styles.remove}
            onPress={() => void removePhoto()}
          />
        ) : null}
      </View>
      <Input
        label="Name"
        tone="muted"
        icon="user"
        value={name}
        onChangeText={setName}
        maxLength={80}
        autoCapitalize="words"
      />
      <Input
        label="Company (optional)"
        tone="muted"
        icon="briefcase"
        value={company}
        onChangeText={setCompany}
        maxLength={120}
        autoCapitalize="words"
      />
      <View style={styles.group}>
        <Text variant="captionMedium" color="muted">
          I'm a…
        </Text>
        <View style={styles.chips}>
          {TYPES.map((value) => (
            <Chip
              key={value}
              label={ACCOUNT_TYPE_LABEL[value]}
              selected={type === value}
              onPress={() => setType(type === value ? null : value)}
            />
          ))}
        </View>
      </View>
      {error ? <Notice tone="danger" message={error} /> : null}
      <Button
        label="Save"
        loading={busy === 'save'}
        disabled={busy === 'photo'}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
  group: { gap: spacing.sm },
  remove: { alignSelf: 'auto', width: 110 },
  row: { flexDirection: 'row', gap: spacing.sm },
});
