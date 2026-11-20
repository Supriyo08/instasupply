import {
  formatClockET,
  formatPhone,
  shortStoreName,
  type Receiving,
  type WindowOption,
} from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, Input, Text } from '@/components/ui';
import type { CartGroup } from '@/features/cart/useCartPricing';
import { colors, spacing } from '@/theme/tokens';

import { AddOptionButton } from './AddOptionButton';
import { updateCheckoutDraft } from './checkout-draft';
import { OptionRow } from './OptionRow';
import type { Checkout } from './useCheckout';

export const RECEIVING_OPTIONS: readonly { value: Receiving; title: string; subtitle: string }[] = [
  { value: 'attended', title: 'Someone on site', subtitle: 'They get a 4-digit code to give the driver' },
  { value: 'unattended', title: 'Leave at site', subtitle: 'The driver takes a photo on drop' },
];

function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.titleRow}>
      <Text variant="heading" style={styles.flex}>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${action} ${title.toLowerCase()}`}
          onPress={onAction}
          hitSlop={8}
        >
          <Text variant="captionMedium" color="primaryDark">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The chosen jobsite: pin, address and site contact; Change → `checkout/jobsite`. */
export function JobsiteCard({ checkout }: { checkout: Checkout }) {
  const { jobsite } = checkout;
  return (
    <Card style={styles.card}>
      <SectionTitle
        title="Jobsite"
        action={jobsite ? 'Change' : undefined}
        onAction={() => router.push('/checkout/jobsite')}
      />
      {jobsite ? (
        <View
          style={styles.jobsite}
          accessible
          accessibilityLabel={`Deliver to ${jobsite.label}, ${jobsite.line1}, ${jobsite.city}. Site contact ${jobsite.contactName}`}
        >
          <View style={styles.pin}>
            <Icon name="map-pin" size={18} color={colors.primaryDark} />
          </View>
          <View style={styles.flex}>
            <Text variant="bodyMedium">{jobsite.label}</Text>
            <Text variant="caption" color="muted">
              {[jobsite.line1, jobsite.line2, jobsite.city, jobsite.postalCode].filter(Boolean).join(', ')}
            </Text>
            <Text variant="caption" color="muted">
              Site contact: {jobsite.contactName} · {formatPhone(jobsite.contactPhone)}
            </Text>
          </View>
        </View>
      ) : (
        <AddOptionButton
          label="Add a jobsite"
          caption="Where should we deliver?"
          onPress={() => router.push({ pathname: '/jobsites/edit', params: { select: '1' } })}
        />
      )}
    </Card>
  );
}

/** "Someone on site (they get a 4-digit code)" / "Leave at site (photo on drop)". */
export function ReceivingCard({ checkout }: { checkout: Checkout }) {
  return (
    <Card style={styles.card}>
      <SectionTitle title="Receiving" />
      <View accessibilityRole="radiogroup" style={styles.options}>
        {RECEIVING_OPTIONS.map((option) => (
          <OptionRow
            key={option.value}
            title={option.title}
            subtitle={option.subtitle}
            icon={option.value === 'attended' ? 'user-check' : 'camera'}
            selected={checkout.receiving === option.value}
            onPress={() => updateCheckoutDraft({ receiving: option.value })}
          />
        ))}
      </View>
    </Card>
  );
}

function storePromises(option: WindowOption, groups: CartGroup[]): string | null {
  if (!option.available || option.kind !== 'asap') return null;
  return option.stores
    .map((timing) => {
      const store = groups.find((group) => group.storeId === timing.storeId)?.store;
      return `${store ? shortStoreName(store.name) : 'Store'} · by ${formatClockET(timing.deliverBy)}`;
    })
    .join('\n');
}

/** "Delivery options": ASAP with each store's promise, or Schedule (→ `checkout/window`). */
export function DeliveryOptionsCard({ checkout }: { checkout: Checkout }) {
  const { windows, selectedWindow, groups } = checkout;
  const asap = windows?.find((option) => option.kind === 'asap') ?? null;
  const scheduled = selectedWindow?.kind === 'scheduled' ? selectedWindow : null;
  return (
    <Card style={styles.card}>
      <SectionTitle title="Delivery options" />
      {!windows ? (
        <Text variant="caption" color="muted">
          Delivery times appear once your jobsite and items can be delivered.
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.options}>
          <OptionRow
            title={asap?.available ? asap.label : 'ASAP'}
            subtitle={asap ? storePromises(asap, groups) : null}
            detail={asap && !asap.available ? asap.reason : null}
            icon="zap"
            disabled={!asap?.available}
            selected={selectedWindow?.kind === 'asap'}
            onPress={() => updateCheckoutDraft({ windowId: 'asap' })}
          />
          <OptionRow
            title={scheduled ? scheduled.label : 'Schedule'}
            subtitle={scheduled ? 'Tap to change the time' : 'Pick a day and a 2-hour window'}
            detail={scheduled && !scheduled.available ? scheduled.reason : null}
            icon="calendar"
            selected={scheduled != null}
            onPress={() => router.push('/checkout/window')}
            trailing={<Icon name="chevron-right" size={18} color={colors.textMuted} />}
          />
        </View>
      )}
    </Card>
  );
}

/** "Add delivery instructions", prefilled from the jobsite (gate code, where to stack). */
export function InstructionsCard({ checkout, onFocus }: { checkout: Checkout; onFocus?: () => void }) {
  const [open, setOpen] = useState(checkout.instructions.length > 0);
  if (!open) {
    return (
      <AddOptionButton
        label="Add delivery instructions"
        caption="Gate code, where to stack"
        onPress={() => setOpen(true)}
      />
    );
  }
  return (
    <Card style={styles.card}>
      <SectionTitle title="Delivery instructions" />
      <Input
        tone="muted"
        multiline
        placeholder="Gate code, where to stack, who to call"
        value={checkout.instructions}
        maxLength={500}
        onFocus={onFocus}
        onChangeText={(instructions) => updateCheckoutDraft({ instructions })}
        accessibilityLabel="Delivery instructions"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  flex: { flex: 1 },
  jobsite: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  options: { gap: spacing.sm },
  pin: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row' },
});
