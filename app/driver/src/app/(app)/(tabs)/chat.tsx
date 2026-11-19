import { QUICK_REPLIES, formatClock, type ChatMessage } from '@instasupply/shared';
import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Icon, IconButton, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { markThreadRead, sendMessage, useMessages, useThread } from '@/features/chat/hooks';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { env } from '@/lib/env';
import { describeError } from '@/lib/errors';
import { callPhone } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? colors.primary : colors.surface,
            borderColor: mine ? colors.primary : colors.border,
            borderRadius: radius.lg,
            borderBottomRightRadius: mine ? 4 : radius.lg,
            borderBottomLeftRadius: mine ? radius.lg : 4,
          },
        ]}
      >
        {!mine ? (
          <Text variant="micro" color="primary">
            {message.senderName}
          </Text>
        ) : null}
        <Text style={{ color: mine ? colors.onPrimary : colors.text }}>{message.text}</Text>
        <Text
          variant="micro"
          style={{ color: mine ? colors.onPrimary : colors.textSubtle, opacity: 0.8, alignSelf: 'flex-end' }}
        >
          {message.createdAt ? formatClock(message.createdAt) : 'Sending…'}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { user, profile } = useDriver();
  const { colors, radius } = useTheme();
  const thread = useThread(user.uid);
  const messages = useMessages(user.uid);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const unread = thread.data?.unreadByDriver ?? 0;
  useEffect(() => {
    if (unread > 0) void markThreadRead(user.uid).catch(() => undefined);
  }, [unread, user.uid]);

  const send = async (body: string, kind: ChatMessage['kind'] = 'text') => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage({ uid: user.uid, senderName: profile.displayName, text: body, kind });
      if (kind === 'text') setText('');
    } catch (error) {
      notify('Message not sent', describeError(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.flex}>
          <Text variant="title">Dispatch</Text>
          <Text variant="caption" color="subtle">
            Messages go to everyone on the dispatch team.
          </Text>
        </View>
        {env.dispatchPhone ? (
          <IconButton
            icon="call"
            label="Call dispatch"
            tone="success"
            onPress={() => void callPhone(env.dispatchPhone!)}
          />
        ) : null}
      </View>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          inverted
          data={messages.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <Bubble message={item} mine={item.senderId === user.uid} />}
          ListEmptyComponent={
            messages.loading ? undefined : (
              <View style={styles.flip}>
                <EmptyState
                  icon="chatbubbles-outline"
                  title="No messages yet"
                  message="Ask dispatch anything — they'll reply here."
                />
              </View>
            )
          }
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickBar}
          contentContainerStyle={styles.quick}
          keyboardShouldPersistTaps="handled"
        >
          {QUICK_REPLIES.map((reply) => (
            <Pressable
              key={reply}
              accessibilityRole="button"
              onPress={() => void send(reply, 'quick_reply')}
              style={[
                styles.chip,
                { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill },
              ]}
            >
              <Text variant="caption">{reply}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput
            accessibilityLabel="Message"
            placeholder="Message dispatch…"
            placeholderTextColor={colors.textSubtle}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            style={[
              styles.input,
              { color: colors.text, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!text.trim() || sending}
            onPress={() => void send(text)}
            style={[styles.send, { backgroundColor: text.trim() ? colors.primary : colors.surfaceMuted }]}
          >
            <Icon name="send" size={18} color={text.trim() ? colors.onPrimary : colors.textSubtle} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleRow: { flexDirection: 'row' },
  chip: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  composer: {
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  fill: { flex: 1 },
  flex: { flex: 1 },
  // The list is inverted, so flip the empty state back upright.
  flip: { transform: [{ scaleY: -1 }] },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingBottom: 14,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 120, minHeight: 44, paddingHorizontal: 14, paddingVertical: 11 },
  list: { gap: 10, padding: 16 },
  quick: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  quickBar: { flexGrow: 0, flexShrink: 0 },
  send: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
});
