import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius } from '@/theme/tokens';

import { Text } from './Text';

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* `padding` on both platforms: Android modals are edge-to-edge too, so they don't resize. */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.fill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text variant="title">{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  handle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: 3, height: 5, width: 44 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    gap: 16,
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
});
