import { describeError } from '@instasupply/api-client';
import { MAX_CHAT_MESSAGE_LENGTH, type SupportContext, type SupportMessage } from '@instasupply/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';

import { Chip, EmptyState, ErrorState, Header, IconButton, Notice, Screen, Skeleton } from '@/components/ui';
import { useCustomer } from '@/features/session/SessionProvider';
import { RequireAccount } from '@/features/session/RequireAccount';
import { ContextChip, MessageBubble } from '@/features/support/components/MessageBubble';
import { useSupportActions, useSupportThread } from '@/features/support/hooks';
import { contextFromParams } from '@/features/support/links';
import { supportHoursBanner } from '@/features/support/support-hours';
import { useNow } from '@/hooks/useNow';
import { newRequestId } from '@/lib/ids';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

const QUICK_TOPICS = ["Where's my order?", 'Change delivery time', 'Problem with an item', 'Billing'];

/** Support chat 🔒 (MARKETPLACE §7.3): context chip, quick topics, hours banner, live messages. */
export default function SupportScreen() {
  return (
    <RequireAccount title="Support chat">
      <SupportBody />
    </RequireAccount>
  );
}

function SupportBody() {
  const { user } = useCustomer();
  const params = useLocalSearchParams<{ kind?: string; id?: string; label?: string }>();
  const [context, setContext] = useState<SupportContext | null>(() => contextFromParams(params));
  const { thread, messages } = useSupportThread(user.uid);
  const { send, markRead } = useSupportActions(user.uid);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<SupportMessage>>(null);
  const input = useRef<TextInputInstance>(null);
  const now = useNow(60_000);
  const hours = supportHoursBanner(now);
  const unread = thread.data?.unreadByOwner ?? 0;

  // Read while the chat is on screen: on focus, and again when a reply arrives meanwhile.
  const markReadRun = markRead.run;
  useFocusEffect(
    useCallback(() => {
      if (unread > 0) void markReadRun().catch(() => undefined);
    }, [unread, markReadRun]),
  );

  useEffect(() => {
    if (messages.data.length > 0) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [messages.data.length]);

  const submit = async () => {
    const body = text.trim();
    if (!body || send.busy) return;
    const id = newRequestId();
    setText('');
    setError(null);
    setPending((current) => new Set(current).add(id));
    try {
      await send.run({ id, text: body, context });
      setContext(null);
    } catch (cause) {
      // The optimistic copy rolled back: give the words back so nothing is lost.
      setText(body);
      setError(describeError(cause));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const composer = (
    <View style={styles.composerWrap}>
      {context ? <ContextChip context={context} onRemove={() => setContext(null)} /> : null}
      {error ? <Notice tone="danger" message={error} /> : null}
      <View style={styles.composer}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder="Write a message"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          accessibilityLabel="Message to InstaSupply support"
          style={styles.input}
        />
        <IconButton
          icon="send"
          label="Send message"
          color={colors.white}
          background={text.trim() ? colors.primaryDark : colors.textSubtle}
          size={44}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );

  const loading = messages.loading && messages.data.length === 0;
  return (
    <Screen
      header={<Header title="Support chat" />}
      scroll={false}
      footer={composer}
      contentStyle={styles.body}
    >
      <Notice
        tone={hours.online ? 'success' : 'info'}
        icon={hours.online ? 'message-circle' : 'clock'}
        title={hours.title}
        message={hours.message}
      />
      {loading ? (
        <View style={styles.skeletons}>
          <Skeleton style={styles.skeletonLeft} />
          <Skeleton style={styles.skeletonRight} />
        </View>
      ) : messages.error && messages.data.length === 0 ? (
        <ErrorState title="Couldn't load the chat" error={messages.error} onRetry={messages.retry} />
      ) : (
        <FlatList
          ref={list}
          style={styles.flex}
          data={messages.data}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              mine={item.senderRole === 'customer'}
              pending={pending.has(item.id)}
            />
          )}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              art="scene-support"
              title="Chat with InstaSupply"
              message="Ask about an order, a delivery time, an item or a bill. Pick a topic or type below."
            />
          }
          ListFooterComponent={
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.topics}
            >
              {QUICK_TOPICS.map((topic) => (
                <Chip
                  key={topic}
                  label={topic}
                  accessibilityLabel={`Quick topic: ${topic}`}
                  onPress={() => {
                    setText(topic);
                    input.current?.focus();
                  }}
                />
              ))}
            </ScrollView>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingHorizontal: spacing.gutter },
  composer: { alignItems: 'flex-end', flexDirection: 'row', gap: spacing.sm },
  composerWrap: { gap: spacing.sm },
  flex: { flex: 1 },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    color: colors.text,
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
  },
  messages: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.md },
  skeletonLeft: { height: 52, width: '62%' },
  skeletonRight: { alignSelf: 'flex-end', height: 40, width: '48%' },
  skeletons: { gap: spacing.md },
  topics: { gap: spacing.sm, paddingVertical: spacing.sm },
});
