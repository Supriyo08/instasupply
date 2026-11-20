import type { Jobsite, LatLng } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, Header, Input, Notice, Screen, Text } from '@/components/ui';
import { updateCheckoutDraft } from '@/features/checkout/checkout-draft';
import { ScrollBody, scrollBodyContainer } from '@/features/checkout/KeyboardScroll';
import { singleParam } from '@/features/checkout/navigation';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { AddressSearch } from '@/features/jobsites/AddressSearch';
import {
  checkDraft,
  draftFrom,
  withGeocode,
  withPin,
  type JobsiteDraft,
  type JobsiteErrors,
} from '@/features/jobsites/jobsite-form';
import { AddressFields, SiteDetails } from '@/features/jobsites/JobsiteFormFields';
import { PinPicker } from '@/features/jobsites/PinPicker';
import { useToast } from '@/features/notifications/ToastProvider';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { deleteJobsite, saveJobsite, useJobsites } from '@/features/site/hooks';
import { useSite } from '@/features/site/SiteProvider';
import { describeError } from '@/lib/api';
import { confirmAction } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

function Editor({
  jobsite,
  firstSite,
  select,
}: {
  jobsite: Jobsite | null;
  firstSite: boolean;
  select: boolean;
}) {
  const { profile } = useCustomer();
  const { chooseJobsite } = useSite();
  const toast = useToast();
  const [draft, setDraft] = useState<JobsiteDraft>(() => draftFrom(jobsite, profile, firstSite));
  const [focus, setFocus] = useState<LatLng | null>(jobsite?.location ?? null);
  const [errors, setErrors] = useState<JobsiteErrors>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const patch = (next: Partial<JobsiteDraft>) => setDraft((current) => ({ ...current, ...next }));

  const save = async () => {
    const checked = checkDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      setFailure(checked.errors.location ?? 'Check the fields marked in red.');
      return;
    }
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      const saved = await saveJobsite({ ...checked.value, id: draft.id, isDefault: draft.isDefault });
      toast({ title: jobsite ? 'Jobsite updated' : 'Jobsite saved', icon: 'map-pin' });
      if (select) {
        updateCheckoutDraft({ jobsiteId: saved.id, receiving: null, instructions: null, windowId: null });
        chooseJobsite(saved.id);
        router.dismissTo('/checkout');
      } else {
        router.back();
      }
    } catch (error) {
      setFailure(describeError(error, "Couldn't save the jobsite. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!jobsite) return;
    const confirmed = await confirmAction(
      `Delete ${jobsite.label}?`,
      'Past orders keep their address. You can add the jobsite again any time.',
      'Delete',
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteJobsite(jobsite.id);
      toast({ title: 'Jobsite deleted', icon: 'trash-2' });
      router.back();
    } catch (error) {
      setFailure(describeError(error, "Couldn't delete the jobsite. Try again."));
      setDeleting(false);
    }
  };

  return (
    <Screen
      header={<Header title={jobsite ? 'Edit jobsite' : 'New jobsite'} />}
      scroll={false}
      contentStyle={scrollBodyContainer}
      footer={
        <Button
          label={jobsite ? 'Save changes' : 'Save jobsite'}
          loading={saving}
          disabled={saving || deleting}
          onPress={() => void save()}
        />
      }
    >
      <ScrollBody ref={null}>
        {failure ? (
          <Notice tone="danger" message={failure} actionLabel="Try again" onAction={() => void save()} />
        ) : null}
        <Card style={styles.card}>
          <Input
            tone="muted"
            label="Jobsite name"
            placeholder="Leslieville semi reno"
            value={draft.label}
            maxLength={40}
            error={errors.label}
            onChangeText={(label) => patch({ label })}
          />
        </Card>

        <Card style={styles.card}>
          <Text variant="heading" accessibilityRole="header">
            Address and pin
          </Text>
          <AddressSearch
            near={draft.location}
            onChoose={(result) => {
              setDraft((current) => withGeocode(current, result));
              setFocus(result.location);
            }}
          />
          <PinPicker
            location={draft.location}
            focus={focus}
            onPick={(point, recentre) => {
              setDraft((current) => withPin(current, point));
              if (recentre) setFocus(point);
            }}
          />
          {errors.location ? (
            <Text variant="caption" color="danger">
              {errors.location}
            </Text>
          ) : null}
          <AddressFields draft={draft} errors={errors} onChange={patch} />
        </Card>

        <SiteDetails draft={draft} errors={errors} onChange={patch} />

        {jobsite ? (
          <Button
            label="Delete jobsite"
            variant="danger"
            icon="trash-2"
            loading={deleting}
            disabled={saving || deleting}
            onPress={() => void remove()}
          />
        ) : null}
        <View style={styles.bottom} />
      </ScrollBody>
    </Screen>
  );
}

function JobsiteEdit() {
  const { user } = useCustomer();
  const params = useLocalSearchParams<{ id?: string; select?: string }>();
  const id = singleParam(params.id) ?? null;
  const select = singleParam(params.select) === '1';
  const jobsites = useJobsites(user.uid);
  const header = <Header title={id ? 'Edit jobsite' : 'New jobsite'} />;

  if (jobsites.loading && jobsites.data.length === 0) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={3} label="Loading the jobsite" />
      </Screen>
    );
  }
  if (jobsites.error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your jobsites" error={jobsites.error} onRetry={jobsites.retry} />
      </Screen>
    );
  }
  const jobsite = id ? (jobsites.data.find((item) => item.id === id) ?? null) : null;
  if (id && !jobsite) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-jobsite-delivery"
          title="Jobsite not found"
          message="It may have been deleted on another device."
          action={<Button label="Back to jobsites" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }
  return (
    <Editor
      key={jobsite?.id ?? 'new'}
      jobsite={jobsite}
      firstSite={jobsites.data.length === 0}
      select={select}
    />
  );
}

/**
 * The jobsite editor (MARKETPLACE §7.3): name, address search, a draggable pin (pin-only for new
 * builds), unit or lot, site contact, instructions, receiving default, largest vehicle and default.
 */
export default function JobsiteEditScreen() {
  return (
    <RequireAccount title="Jobsite">
      <JobsiteEdit />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  bottom: { height: spacing.lg },
  card: { gap: spacing.md },
});
