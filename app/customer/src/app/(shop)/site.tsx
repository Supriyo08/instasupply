import type { Jobsite } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, Header, Icon, Notice, Screen, Text } from '@/components/ui';
import { goToSignIn } from '@/features/session/RequireAccount';
import { useSession, useUid } from '@/features/session/SessionProvider';
import { AddressSearch } from '@/features/site/components/AddressSearch';
import { PinPicker } from '@/features/site/components/PinPicker';
import { SaveAsJobsite } from '@/features/site/components/SaveAsJobsite';
import { SavedJobsites } from '@/features/site/components/SavedJobsites';
import { useJobsites } from '@/features/site/hooks';
import { locateMe } from '@/features/site/location';
import { fromGeocode, fromPoint, type PlaceDetails } from '@/features/site/place';
import { useSite } from '@/features/site/SiteProvider';
import { colors, spacing } from '@/theme/tokens';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * "Deliver to" sheet (MARKETPLACE §7.3): saved jobsites, current location, address search, drop a
 * pin, and 🔒 "Save as jobsite". Every distance, promise and price preview follows the choice.
 */
export default function SiteSheet() {
  const uid = useUid();
  const { profile } = useSession();
  const { site, chooseJobsite, choosePoint } = useSite();
  const jobsites = useJobsites(uid);
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const applyPlace = (next: PlaceDetails) => {
    choosePoint({
      location: next.location,
      label: next.label,
      addressLine: next.line1,
      source: next.source,
    });
    setPinOpen(false);
    // Signed in, stay to offer "Save as jobsite"; a guest is done.
    if (uid) setPlace(next);
    else close();
  };

  const pickJobsite = (jobsite: Jobsite) => {
    chooseJobsite(jobsite.id);
    close();
  };

  const locate = async () => {
    setLocating(true);
    setLocateError(null);
    const result = await locateMe();
    setLocating(false);
    if (result.ok) applyPlace(fromPoint(result.location, 'gps'));
    else setLocateError(result.message);
  };

  return (
    <Screen header={<Header title="Deliver to" onBack={close} />}>
      <Card style={styles.current}>
        <Icon name="map-pin" size={20} color={colors.primaryDark} />
        <View style={styles.flex}>
          <Text variant="caption" color="muted">
            Delivering to
          </Text>
          <Text variant="bodyMedium" numberOfLines={1}>
            {site?.label ?? 'No jobsite chosen yet'}
          </Text>
          {site?.addressLine ? (
            <Text variant="caption" color="muted" numberOfLines={1}>
              {site.addressLine}
            </Text>
          ) : null}
        </View>
        {place ? <Button label="Done" size="md" style={styles.done} onPress={close} /> : null}
      </Card>

      {place && profile ? (
        <SaveAsJobsite
          key={`${place.location.lat},${place.location.lng}`}
          place={place}
          profile={profile}
          makeDefault={jobsites.data.length === 0}
          onSaved={(saved) => {
            chooseJobsite(saved.id);
            close();
          }}
        />
      ) : null}

      {uid ? (
        <SavedJobsites
          jobsites={jobsites.data}
          selectedId={site?.jobsite?.id ?? null}
          loading={jobsites.loading}
          error={jobsites.error}
          onRetry={jobsites.retry}
          onSelect={pickJobsite}
        />
      ) : (
        <Notice
          tone="info"
          message="Sign in to save jobsites with a site contact and use them at checkout."
          actionLabel="Sign in"
          onAction={() => goToSignIn('/site')}
        />
      )}

      <Divider />
      <View style={styles.section}>
        <Button
          label="Use current location"
          variant="secondary"
          icon="navigation"
          loading={locating}
          onPress={() => void locate()}
        />
        {locateError ? <Notice tone="warning" message={locateError} /> : null}
      </View>

      <AddressSearch near={site?.location ?? null} onPick={(result) => applyPlace(fromGeocode(result))} />

      <View style={styles.section}>
        <Text variant="heading">Drop a pin</Text>
        {pinOpen ? (
          <PinPicker start={site?.location ?? null} onUse={(point) => applyPlace(fromPoint(point, 'pin'))} />
        ) : (
          <Button label="Open the map" variant="secondary" icon="map" onPress={() => setPinOpen(true)} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  current: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  done: { alignSelf: 'auto', minWidth: 88 },
  flex: { flex: 1 },
  section: { gap: spacing.md },
});
