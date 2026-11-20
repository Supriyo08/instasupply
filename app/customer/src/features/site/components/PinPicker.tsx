import { isInServiceArea, r6, type LatLng } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppMap, TORONTO } from '@/components/map';
import { Button, Notice, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/**
 * "Drop a pin": a draggable pin on the map (tap to move it). New builds often have no civic address,
 * so a pin inside the service area is enough.
 */
export function PinPicker({ start, onUse }: { start: LatLng | null; onUse: (point: LatLng) => void }) {
  const [pin, setPin] = useState<LatLng>(start ?? TORONTO);
  const inside = isInServiceArea(pin);
  return (
    <View style={styles.section}>
      <Text variant="caption" color="muted">
        Drag the pin, or tap the map, to mark where the load should go.
      </Text>
      <AppMap
        interactive
        initialCenter={start ?? TORONTO}
        initialZoom={start ? 15 : 11}
        pick={{ position: pin }}
        onPick={(point) => setPin(r6(point))}
        style={styles.map}
        accessibilityLabel="Map with a pin you can move to your jobsite"
      />
      {inside ? null : (
        <Notice tone="warning" message="InstaSupply delivers in the Greater Toronto Area only." />
      )}
      <Button label="Use this pin" icon="map-pin" disabled={!inside} onPress={() => onUse(pin)} />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { borderRadius: 12, height: 300, overflow: 'hidden' },
  section: { gap: spacing.md },
});
