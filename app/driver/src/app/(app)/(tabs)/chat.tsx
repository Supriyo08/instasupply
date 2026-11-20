import {
  MAX_CHAT_MESSAGE_LENGTH,
  QUICK_REPLIES,
  formatClockET,
  formatPhone,
  type ChatMessage,
} from '@instasupply/shared';
import { useConfig } from '@instasupply/api-client/react';
import { useState } from 'react';
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

import { TabHeader } from '@/components/TabHeader';
import { Banner, EmptyState, ErrorState, Icon, IconButton, Skeleton, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { useMarkThreadReadWhenVisible, useMessages, useSendMessage, useThread } from '@/features/chat/hooks';
import { describeError } from '@/lib/api';
import { callPhone } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { colors, radius } = useTheme();
  const time = formatClockET(message.createdAt);
  return (
    <View
      accessible
      accessibilityLabel={`${mine ? 'You' : message.senderName}, ${time}: ${message.text}`}
      style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}
    >
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
        <Text variant="micro" style={[styles.time, { color: mine ? colors.onPrimary : colors.textSubtle }]}>
          {time}
        </Text>
      </View>
    </View>
  );
}

/**
 * Dispatch chat (MARKETPLACE §10 `(tabs)/chat`, §2.3 quick replies; CLIENTS §4.6). The thread is marked
 * read only while this tab is focused and the app is in the foreground (R58, R65), and every send has
 * its own message id, so two quick taps send two messages.
 */
export default function ChatScreen() {
  const { user, profile } = useDriver();
  const { colors, radius } = useTheme();
  const config = useConfig();
  const thread = useThread(user.uid);
  const messages = useMessages(user.uid);
  const { send, sending } = useSendMessage(user.uid, profile.displayName);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useMarkThreadReadWhenVisible(user.uid, thread.data);

  const supportPhone = config?.supportPhone ?? null;
  // The list is inverted, so the newest message sits at the bottom next to the composer.
  const newestFirst = [...messages.data].reverse();

  const submit = async (body: string, kind: ChatMessage['kind']) => {
    if (!body.trim()) return;
    setProblem(null);
    if (kind === 'text') setText('');
    try {
      await send({ text: body, kind });
    } catch (error) {
      if (kind === 'text') setText((current) => current || body);
      setProblem(describeError(error));
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TabHeader
          title="Dispatch"
          subtitle="Messages reach everyone on the dispatch team."
          right={
            supportPhone ? (
              <IconButton
                icon="call"
                label={`Call dispatch, ${formatPhone(supportPhone)}`}
                tone="success"
                onPress={() => void callPhone(supportPhone)}
              />
            ) : undefined
          }
        />
      </View>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {messages.loading ? (
          <View style={styles.loading} accessibilityLabel="Loading messages">
            <Skeleton width="60%" height={48} radius={16} />
            <Skeleton width="45%" height={48} radius={16} style={styles.right} />
            <Skeleton width="70%" height={48} radius={16} />
          </View>
        ) : messages.error ? (
          <View style={styles.fill}>
            <ErrorState error={messages.error} onRetry={messages.retry} title="Couldn't load messages" />
          </View>
        ) : (
          <FlatList
            inverted={newestFirst.length > 0}
            data={newestFirst}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <Bubble message={item} mine={item.senderId === user.uid} />}
            ListEmptyComponent={
              <EmptyState
                icon="chatbubbles-outline"
                title="No messages yet"
                message="Store not ready, gate locked, need a hand unloading? Message dispatch here."
              />
            }
          />
        )}
        {problem ? (
          <View style={styles.problem}>
            <Banner tone="danger" title="Message not sent" message={problem} />
          </View>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickBar}
          contentContainerStyle={styles.quick}
          keyboardShouldPersistTaps="handled"
          accessibilityLabel="Quick replies"
        >
          {QUICK_REPLIES.map((reply) => (
            <Pressable
              key={reply}
              accessibilityRole="button"
              accessibilityLabel={`Send: ${reply}`}
              onPress={() => void submit(reply, 'quick_reply')}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text variant="caption">{reply}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput
            accessibilityLabel="Message to dispatch"
            placeholder="Message dispatch…"
            placeholderTextColor={colors.textSubtle}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            style={[
              styles.input,
              { color: colors.text, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !text.trim(), busy: sending }}
            disabled={!text.trim()}
            onPress={() => void submit(text, 'text')}
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
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 12 },
  input: { flex: 1, fontSize: 16, maxHeight: 120, minHeight: 44, paddingHorizontal: 14, paddingVertical: 11 },
  list: { flexGrow: 1, gap: 10, padding: 16 },
  loading: { flex: 1, gap: 12, padding: 16 },
  problem: { paddingHorizontal: 12, paddingTop: 8 },
  quick: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  quickBar: { flexGrow: 0, flexShrink: 0 },
  right: { alignSelf: 'flex-end' },
  send: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  time: { alignSelf: 'flex-end', opacity: 0.8 },
});
