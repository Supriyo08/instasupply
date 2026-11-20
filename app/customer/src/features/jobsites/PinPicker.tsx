import { isInServiceArea, type LatLng } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppMap, fitKeyFor, type MapFit } from '@/components/map';
import { Button, Notice, Text } from '@/components/ui';
import { locateMe } from '@/features/site/location';
import { radius, spacing } from '@/theme/tokens';

/**
 * "Drop a pin": a draggable pin on `AppMap` (tap to place, drag to adjust) and "Use current
 * location". New builds often have no civic address, so a pin alone is enough. The camera only
 * moves when `focus` changes (an address result, the GPS), never while the pin is dragged.
 */
export function PinPicker({
  location,
  focus,
  onPick,
}: {
  location: LatLng | null;
  /** The point to fly to; set it when a search result or the GPS moves the pin. */
  focus: LatLng | null;
  onPick: (point: LatLng, recentre: boolean) => void;
}) {
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fit: MapFit | null = focus ? { key: fitKeyFor([focus]), points: [focus], maxZoom: 17 } : null;
  const outside = location != null && !isInServiceArea(location);

  const locateHere = async () => {
    setLocating(true);
    setMessage(null);
    const result = await locateMe();
    setLocating(false);
    if (result.ok) onPick(result.location, true);
    else setMessage(result.message);
  };

  return (
    <View style={styles.wrap}>
      <AppMap
        interactive
        style={styles.map}
        fit={fit}
        pick={{ position: location }}
        onPick={(point) => onPick(point, false)}
        markers={[]}
        accessibilityLabel={
          location
            ? 'Map with the jobsite pin. Tap the map or drag the pin to move it.'
            : 'Map of the Greater Toronto Area. Tap where the jobsite is to drop a pin.'
        }
      />
      <Text variant="caption" color="muted">
        {location
          ? 'Drag the pin to the spot where the load should be dropped.'
          : 'Tap the map to drop a pin. A pin is enough for a new build without an address.'}
      </Text>
      {outside ? (
        <Notice tone="warning" message="That pin is outside the Greater Toronto Area, where we deliver." />
      ) : null}
      {message ? <Notice tone="warning" message={message} /> : null}
      <Button
        label="Use current location"
        icon="navigation"
        variant="secondary"
        loading={locating}
        onPress={() => void locateHere()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { borderRadius: radius.md, height: 240, overflow: 'hidden' },
  wrap: { gap: spacing.sm },
});
