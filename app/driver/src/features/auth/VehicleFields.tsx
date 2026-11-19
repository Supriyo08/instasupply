import { VEHICLE_META, VEHICLE_TYPES, type VehicleType } from '@instasupply/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Input, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export interface VehicleValue {
  type: VehicleType;
  plate: string;
  model: string;
}

export function VehicleFields({
  value,
  onChange,
  errors = {},
}: {
  value: VehicleValue;
  onChange: (value: VehicleValue) => void;
  errors?: Partial<Record<keyof VehicleValue, string>>;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={styles.wrapper}>
      <Text variant="caption" color="muted">
        Vehicle
      </Text>
      <View style={styles.chips}>
        {VEHICLE_TYPES.map((type) => {
          const selected = value.type === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange({ ...value, type })}
              style={[
                styles.chip,
                {
                  borderRadius: radius.pill,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primarySoft : colors.surface,
                },
              ]}
            >
              <Text variant="caption" style={{ color: selected ? colors.primary : colors.textMuted }}>
                {VEHICLE_META[type].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label="Registration number"
        placeholder="KA01AB1234"
        autoCapitalize="characters"
        value={value.plate}
        onChangeText={(plate) => onChange({ ...value, plate })}
        error={errors.plate}
      />
      <Input
        label="Make & model (optional)"
        placeholder="Honda Activa"
        value={value.model}
        onChangeText={(model) => onChange({ ...value, model })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wrapper: { gap: 12 },
});
