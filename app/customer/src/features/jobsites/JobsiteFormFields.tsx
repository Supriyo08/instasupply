import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Chip, Input, Text, Toggle } from '@/components/ui';
import { RECEIVING_OPTIONS } from '@/features/checkout/DeliverySection';
import { OptionRow } from '@/features/checkout/OptionRow';
import { COUNTRY_CODE } from '@/features/session/components/phone';
import { spacing } from '@/theme/tokens';

import { VEHICLE_LIMITS, type JobsiteDraft, type JobsiteErrors } from './jobsite-form';

type Patch = (patch: Partial<JobsiteDraft>) => void;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={styles.card}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </Card>
  );
}

/** Line 1 (street or "Lot 14, Phase 3"), unit or lot, city and postal code (optional for a new build). */
export function AddressFields({
  draft,
  errors,
  onChange,
}: {
  draft: JobsiteDraft;
  errors: JobsiteErrors;
  onChange: Patch;
}) {
  return (
    <View style={styles.fields}>
      <Input
        tone="muted"
        label="Street address or lot"
        placeholder="12 Carlaw Ave, or Lot 14, Phase 3"
        value={draft.line1}
        maxLength={160}
        error={errors.line1}
        onChangeText={(line1) => onChange({ line1 })}
      />
      <Input
        tone="muted"
        label="Unit or lot (optional)"
        placeholder="Unit 3"
        value={draft.line2}
        maxLength={60}
        error={errors.line2}
        onChangeText={(line2) => onChange({ line2 })}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input
            tone="muted"
            label="City"
            placeholder="Toronto"
            value={draft.city}
            maxLength={60}
            error={errors.city ?? errors.cityId}
            onChangeText={(city) => onChange({ city })}
          />
        </View>
        <View style={styles.flex}>
          <Input
            tone="muted"
            label="Postal code"
            placeholder="M4M 2R7"
            value={draft.postalCode}
            maxLength={7}
            autoCapitalize="characters"
            hint="Optional for a new build"
            error={errors.postalCode}
            onChangeText={(postalCode) => onChange({ postalCode: postalCode.toUpperCase() })}
          />
        </View>
      </View>
      {draft.areaLabel ? (
        <Text variant="caption" color="muted">
          Area shown to drivers: {draft.areaLabel}
        </Text>
      ) : null}
    </View>
  );
}

/** Site contact, instructions, receiving default, largest vehicle and the default flag. */
export function SiteDetails({
  draft,
  errors,
  onChange,
}: {
  draft: JobsiteDraft;
  errors: JobsiteErrors;
  onChange: Patch;
}) {
  return (
    <>
      <Section title="Site contact">
        <Input
          tone="muted"
          label="Name"
          placeholder="Who meets the driver"
          value={draft.contactName}
          maxLength={80}
          autoCapitalize="words"
          error={errors.contactName}
          onChangeText={(contactName) => onChange({ contactName })}
        />
        <Input
          tone="muted"
          label={`Phone (${COUNTRY_CODE})`}
          placeholder="(416) 555-0110"
          keyboardType="phone-pad"
          autoComplete="tel-national"
          value={draft.contactPhone}
          maxLength={18}
          error={errors.contactPhone}
          onChangeText={(contactPhone) => onChange({ contactPhone })}
        />
        <Input
          tone="muted"
          multiline
          label="Site instructions (optional)"
          placeholder="Gate code, where to stack, parking"
          value={draft.instructions}
          maxLength={500}
          error={errors.instructions}
          onChangeText={(instructions) => onChange({ instructions })}
        />
      </Section>

      <Section title="Receiving">
        <View accessibilityRole="radiogroup" style={styles.fields}>
          {RECEIVING_OPTIONS.map((option) => (
            <OptionRow
              key={option.value}
              title={option.title}
              subtitle={option.subtitle}
              icon={option.value === 'attended' ? 'user-check' : 'camera'}
              selected={draft.receiving === option.value}
              onPress={() => onChange({ receiving: option.value })}
            />
          ))}
        </View>
      </Section>

      <Section title="Largest vehicle that fits">
        <Text variant="caption" color="muted">
          Narrow lane or low wires? Pick the largest truck that can reach the drop spot, e.g. cargo van max.
        </Text>
        <View style={styles.chips}>
          {VEHICLE_LIMITS.map((option) => (
            <Chip
              key={option.label}
              label={option.label}
              selected={draft.maxVehicleClass === option.value}
              onPress={() => onChange({ maxVehicleClass: option.value })}
              accessibilityLabel={option.value ? `${option.label} max` : 'No vehicle limit'}
            />
          ))}
        </View>
        {errors.maxVehicleClass ? (
          <Text variant="caption" color="danger">
            {errors.maxVehicleClass}
          </Text>
        ) : null}
      </Section>

      <Card style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text variant="bodyMedium">Default jobsite</Text>
          <Text variant="caption" color="muted">
            Used for new orders and delivery estimates.
          </Text>
        </View>
        <Toggle
          label="Default jobsite"
          value={draft.isDefault}
          onValueChange={(isDefault) => onChange({ isDefault })}
        />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fields: { gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
