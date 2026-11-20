import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

function FooterCard({ title, body, art, href }: { title: string; body: string; art: string; href: Href }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <ArtImage artKey={art} size={64} />
      <View style={styles.copy}>
        <Text variant="subheading">{title}</Text>
        <Text variant="caption" color="muted">
          {body}
        </Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

/** Home's last two cards: the material list and "Suggest a store". */
export function FooterCards() {
  return (
    <View style={styles.list}>
      <FooterCard
        title="Send us your material list"
        body="Type it, paste it, or upload a photo. Expect a quote within 30 minutes during business hours."
        art="scene-material-list"
        href="/quotes/new"
      />
      <FooterCard
        title="Don't see your supplier?"
        body="Suggest a store and we'll invite them to InstaSupply."
        art="scene-local-suppliers"
        href="/suggest-store"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  copy: { flex: 1, gap: 2 },
  list: { gap: spacing.md },
  pressed: { opacity: 0.85 },
});
