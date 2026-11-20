import {
  PICKUP_BOX_LENGTHS_FT,
  VEHICLE_EXTRA_LABELS,
  VEHICLE_EXTRAS,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  type VehicleExtra,
} from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Chip, Input, Text } from '@/components/ui';

import { expectedClassLabel, type VehicleFormErrors, type VehicleFormValue } from './vehicle-form';

/**
 * The vehicle fields of MARKETPLACE §10: type chips, make, model, year, plate, colour, the pickup box
 * (pickups only), payload (optional) and extras. Used by onboarding/vehicle and the Vehicle screen.
 */
export function VehicleFields({
  value,
  onChange,
  errors = {},
  disabled = false,
}: {
  value: VehicleFormValue;
  onChange: (next: VehicleFormValue) => void;
  errors?: VehicleFormErrors;
  disabled?: boolean;
}) {
  const set = <K extends keyof VehicleFormValue>(key: K, next: VehicleFormValue[K]) =>
    onChange({ ...value, [key]: next });
  const toggleExtra = (extra: VehicleExtra) =>
    set(
      'extras',
      value.extras.includes(extra) ? value.extras.filter((item) => item !== extra) : [...value.extras, extra],
    );
  const rated = expectedClassLabel(value);

  return (
    <View style={styles.wrapper}>
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Vehicle type">
        <Text variant="caption" color="muted">
          Vehicle type
        </Text>
        <View style={styles.chips}>
          {VEHICLE_TYPES.map((type) => (
            <Chip
              key={type}
              label={VEHICLE_TYPE_LABELS[type]}
              selected={value.type === type}
              disabled={disabled}
              onPress={() =>
                onChange({ ...value, type, boxLengthFt: type === 'pickup' ? value.boxLengthFt : null })
              }
            />
          ))}
        </View>
        {errors.type ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
            {errors.type}
          </Text>
        ) : null}
        {rated ? (
          <Text variant="caption" color="subtle">
            Usually rated as {rated}. Ops confirm the class when they review your vehicle.
          </Text>
        ) : null}
      </View>

      {value.type === 'pickup' ? (
        <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Pickup box length">
          <Text variant="caption" color="muted">
            Pickup box
          </Text>
          <View style={styles.chips}>
            {PICKUP_BOX_LENGTHS_FT.map((feet) => (
              <Chip
                key={feet}
                label={`${feet} ft`}
                selected={value.boxLengthFt === feet}
                disabled={disabled}
                onPress={() => set('boxLengthFt', feet)}
              />
            ))}
          </View>
          {errors.boxLengthFt ? (
            <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
              {errors.boxLengthFt}
            </Text>
          ) : (
            <Text variant="caption" color="subtle">
              A box of 6.5 ft or more carries 4×8 sheets flat.
            </Text>
          )}
        </View>
      ) : null}

      <View style={styles.pair}>
        <View style={styles.flex}>
          <Input
            label="Make"
            placeholder="Ford"
            autoCapitalize="words"
            editable={!disabled}
            value={value.make}
            onChangeText={(make) => set('make', make)}
            error={errors.make}
          />
        </View>
        <View style={styles.flex}>
          <Input
            label="Model"
            placeholder="F-150"
            autoCapitalize="words"
            editable={!disabled}
            value={value.model}
            onChangeText={(model) => set('model', model)}
            error={errors.model}
          />
        </View>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Input
            label="Year"
            placeholder="2021"
            keyboardType="number-pad"
            maxLength={4}
            editable={!disabled}
            value={value.year}
            onChangeText={(year) => set('year', year.replace(/\D/g, ''))}
            error={errors.year}
          />
        </View>
        <View style={styles.flex}>
          <Input
            label="Colour (optional)"
            placeholder="White"
            autoCapitalize="words"
            editable={!disabled}
            value={value.colour}
            onChangeText={(colour) => set('colour', colour)}
            error={errors.colour}
          />
        </View>
      </View>
      <Input
        label="Licence plate"
        placeholder="CBKX 214"
        hint="e.g. CBKX 214. Stores check it at the counter."
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={10}
        editable={!disabled}
        value={value.plate}
        onChangeText={(plate) => set('plate', plate.toUpperCase())}
        error={errors.plate}
      />
      <Input
        label="Payload in kg (optional)"
        placeholder="700"
        keyboardType="decimal-pad"
        editable={!disabled}
        value={value.payloadKg}
        onChangeText={(payload) => set('payloadKg', payload.replace(/[^\d.,]/g, ''))}
        error={errors.payloadKg}
      />

      <View style={styles.group} accessibilityLabel="Extras">
        <Text variant="caption" color="muted">
          Extras
        </Text>
        <View style={styles.chips}>
          {VEHICLE_EXTRAS.map((extra) => (
            <Chip
              key={extra}
              label={VEHICLE_EXTRA_LABELS[extra]}
              icon={value.extras.includes(extra) ? 'checkmark' : 'add'}
              selected={value.extras.includes(extra)}
              disabled={disabled}
              onPress={() => toggleExtra(extra)}
            />
          ))}
        </View>
        {errors.extras ? (
          <Text variant="caption" color="danger">
            {errors.extras}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1 },
  group: { gap: 8 },
  pair: { flexDirection: 'row', gap: 12 },
  wrapper: { gap: 16 },
});
