import type { Jobsite } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Badge, EmptyState, ErrorState, Header, Screen, Text } from '@/components/ui';
import { AddOptionButton } from '@/features/checkout/AddOptionButton';
import { updateCheckoutDraft } from '@/features/checkout/checkout-draft';
import { OptionRow } from '@/features/checkout/OptionRow';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { useCheckout } from '@/features/checkout/useCheckout';
import { jobsiteAddress } from '@/features/jobsites/jobsite-form';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useSite } from '@/features/site/SiteProvider';
import { spacing } from '@/theme/tokens';

function addJobsite() {
  router.push({ pathname: '/jobsites/edit', params: { select: '1' } });
}

function JobsitePicker() {
  const { user } = useCustomer();
  const checkout = useCheckout(user.uid);
  const { chooseJobsite } = useSite();

  const choose = (jobsite: Jobsite) => {
    // A new jobsite brings its own receiving, instructions and delivery times.
    updateCheckoutDraft({
      jobsiteId: jobsite.id,
      receiving: null,
      instructions: null,
      windowId: null,
      serverWindows: null,
    });
    chooseJobsite(jobsite.id);
    router.back();
  };

  const header = <Header title="Jobsite" />;
  if (checkout.loading && checkout.jobsites.length === 0) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={3} label="Loading your jobsites" />
      </Screen>
    );
  }
  if (checkout.error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your jobsites" error={checkout.error} onRetry={checkout.retry} />
      </Screen>
    );
  }
  if (checkout.jobsites.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-jobsite-delivery"
          title="Add your first jobsite"
          message="Save the address or drop a pin, the site contact and how the load is received."
          action={<AddOptionButton label="Add a jobsite" onPress={addJobsite} />}
        />
      </Screen>
    );
  }
  return (
    <Screen header={header}>
      <Text color="muted">Where should we deliver this order?</Text>
      <View accessibilityRole="radiogroup" style={styles.list}>
        {checkout.jobsites.map((jobsite) => (
          <OptionRow
            key={jobsite.id}
            title={jobsite.label}
            subtitle={jobsiteAddress(jobsite)}
            detail={`Site contact: ${jobsite.contactName}`}
            icon="map-pin"
            selected={checkout.jobsite?.id === jobsite.id}
            onPress={() => choose(jobsite)}
            trailing={jobsite.isDefault ? <Badge label="Default" tone="success" /> : null}
          />
        ))}
      </View>
      <AddOptionButton label="Add a jobsite" caption="Address search or drop a pin" onPress={addJobsite} />
    </Screen>
  );
}

/** Choose or add the jobsite for this delivery (MARKETPLACE §7.3 checkout/jobsite). */
export default function CheckoutJobsiteScreen() {
  return (
    <RequireAccount title="Jobsite">
      <JobsitePicker />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
