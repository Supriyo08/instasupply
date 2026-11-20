import type { Jobsite } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, ErrorState, Header, IconButton, Notice, Screen } from '@/components/ui';
import { AddOptionButton } from '@/features/checkout/AddOptionButton';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { JobsiteCard, type JobsiteBusy } from '@/features/jobsites/JobsiteCard';
import { useToast } from '@/features/notifications/ToastProvider';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { deleteJobsite, setDefaultJobsite, useJobsites } from '@/features/site/hooks';
import { useNow } from '@/hooks/useNow';
import { describeError } from '@/lib/api';
import { confirmAction } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

/** Default first, then the most recently used, then by name. */
function sortJobsites(list: readonly Jobsite[]): Jobsite[] {
  return [...list].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) ||
      a.label.localeCompare(b.label),
  );
}

function edit(id?: string) {
  router.push(id ? { pathname: '/jobsites/edit', params: { id } } : '/jobsites/edit');
}

function Jobsites() {
  const { user } = useCustomer();
  const jobsites = useJobsites(user.uid);
  const now = useNow(60_000);
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; kind: JobsiteBusy } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const makeDefault = async (jobsite: Jobsite) => {
    setBusy({ id: jobsite.id, kind: 'default' });
    setFailure(null);
    try {
      await setDefaultJobsite(jobsite);
      toast({ title: `${jobsite.label} is now your default`, icon: 'check-circle' });
    } catch (error) {
      setFailure(describeError(error, "Couldn't change the default jobsite. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (jobsite: Jobsite) => {
    const confirmed = await confirmAction(
      `Delete ${jobsite.label}?`,
      jobsite.isDefault
        ? 'Your most recently used jobsite becomes the default. Past orders keep their address.'
        : 'Past orders keep their address.',
      'Delete',
    );
    if (!confirmed) return;
    setBusy({ id: jobsite.id, kind: 'delete' });
    setFailure(null);
    try {
      await deleteJobsite(jobsite.id);
      toast({ title: 'Jobsite deleted', icon: 'trash-2' });
    } catch (error) {
      setFailure(describeError(error, "Couldn't delete the jobsite. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <Header
      title="Jobsites"
      right={<IconButton icon="plus" label="Add a jobsite" onPress={() => edit()} />}
    />
  );
  if (jobsites.loading && jobsites.data.length === 0) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={3} label="Loading your jobsites" />
      </Screen>
    );
  }
  if (jobsites.error && jobsites.data.length === 0) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your jobsites" error={jobsites.error} onRetry={jobsites.retry} />
      </Screen>
    );
  }
  if (jobsites.data.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-jobsite-delivery"
          title="No jobsites yet"
          message="Save each site once: the address or a dropped pin, the site contact and how loads are received."
          action={<Button label="Add a jobsite" icon="plus" onPress={() => edit()} />}
        />
      </Screen>
    );
  }
  return (
    <Screen header={header} refreshing={jobsites.refreshing} onRefresh={jobsites.retry}>
      {failure ? <Notice tone="danger" message={failure} /> : null}
      <View style={styles.list}>
        {sortJobsites(jobsites.data).map((jobsite) => (
          <JobsiteCard
            key={jobsite.id}
            jobsite={jobsite}
            now={now}
            busy={busy?.id === jobsite.id ? busy.kind : null}
            onEdit={() => edit(jobsite.id)}
            onMakeDefault={() => void makeDefault(jobsite)}
            onDelete={() => void remove(jobsite)}
          />
        ))}
      </View>
      <AddOptionButton label="Add a jobsite" caption="Address search or drop a pin" onPress={() => edit()} />
    </Screen>
  );
}

/** Saved jobsites, default first, with the last one used (MARKETPLACE §7.3 jobsites/index). */
export default function JobsitesScreen() {
  return (
    <RequireAccount title="Jobsites">
      <Jobsites />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});
