import { useConfig } from '@instasupply/api-client/react';
import { formatPhone } from '@instasupply/shared';
import { router } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { ArtImage, Button, Card, Header, Screen, Text } from '@/components/ui';
import { FaqItem } from '@/features/account/FaqItem';
import { FAQ } from '@/features/account/faq';
import { contactSupport } from '@/features/account/support';
import { goToSignIn } from '@/features/session/RequireAccount';
import { useUid } from '@/features/session/SessionProvider';
import { colors, radius, spacing } from '@/theme/tokens';

/** Help & FAQ (MARKETPLACE §7.3): the site's answers, support chat, phone and email from /config. */
export default function HelpScreen() {
  const config = useConfig();
  const uid = useUid();
  const phone = config?.supportPhone ?? null;
  const email = config?.supportEmail ?? null;

  return (
    <Screen header={<Header title="Help & FAQ" />}>
      <View style={styles.hero}>
        <View style={styles.circle}>
          <ArtImage artKey="scene-support" width={170} height={130} />
        </View>
        <Text variant="title" align="center">
          How can we help?
        </Text>
        <Text color="muted" align="center">
          Answers about ordering, delivery to your jobsite, pickup, payments and returns.
        </Text>
      </View>

      {FAQ.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="captionMedium" color="muted" style={styles.groupTitle} accessibilityRole="header">
            {group.title}
          </Text>
          <Card padded={false} style={styles.card}>
            {group.entries.map((entry, index) => (
              <FaqItem key={entry.question} entry={entry} first={index === 0} />
            ))}
          </Card>
        </View>
      ))}

      <Card style={styles.contact}>
        <Text variant="heading">Still need a hand?</Text>
        <Text variant="caption" color="muted">
          Support chat: Mon–Fri 7 am–6 pm, Sat 8 am–2 pm (Toronto time).
        </Text>
        <Button
          label="Chat with support"
          icon="message-circle"
          onPress={() => (uid ? router.push('/support') : goToSignIn('/support'))}
        />
        {phone ? (
          <Button
            label={`Call ${formatPhone(phone)}`}
            icon="phone"
            variant="secondary"
            onPress={() => void contactSupport()}
          />
        ) : null}
        {email ? (
          <Button
            label={`Email ${email}`}
            icon="mail"
            variant="ghost"
            onPress={() => void Linking.openURL(`mailto:${email}`).catch(() => undefined)}
          />
        ) : null}
        {config?.hstNumber ? (
          <Text variant="caption" color="muted" align="center">
            HST registration no. {config.hstNumber}
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  circle: {
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    height: 180,
    justifyContent: 'center',
    width: 180,
  },
  contact: { gap: spacing.md },
  group: { gap: spacing.sm },
  groupTitle: { letterSpacing: 0.3, paddingHorizontal: 4, textTransform: 'uppercase' },
  hero: { alignItems: 'center', gap: spacing.sm },
});
