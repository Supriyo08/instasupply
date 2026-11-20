import { formatMoney } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Header,
  Notice,
  Screen,
  StatusPill,
  Text,
} from '@/components/ui';
import { IssuePhoto } from '@/features/issues/components/IssuePhoto';
import { useIssue } from '@/features/issues/hooks';
import { ISSUE_STATUS, issueTypeLabel, resolutionLabel } from '@/features/issues/issue-format';
import { OrderDetailSkeleton } from '@/features/orders/components/Skeletons';
import { Timeline, type TimelineItem } from '@/features/orders/components/Timeline';
import { dayAndClock } from '@/features/orders/order-format';
import { firstParam } from '@/features/orders/params';
import { RequireAccount } from '@/features/session/RequireAccount';
import { supportHref } from '@/features/support/links';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme/tokens';

/** A reported problem 🔒 (MARKETPLACE §7.3 issues/[id]): status, resolution, refund, support chat. */
export default function IssueScreen() {
  return (
    <RequireAccount title="Problem report">
      <IssueBody />
    </RequireAccount>
  );
}

function IssueBody() {
  const issueId = firstParam(useLocalSearchParams<{ id: string }>().id);
  const issue = useIssue(issueId);
  const now = useNow(60_000);
  const data = issue.data;
  const header = <Header title={data?.number ?? 'Problem report'} />;

  if (issue.loading && !data) {
    return (
      <Screen header={header}>
        <OrderDetailSkeleton />
      </Screen>
    );
  }
  if (issue.error && !data) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load this case" error={issue.error} onRetry={issue.retry} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-report-issue"
          title="Case not found"
          message="It may have just been sent. Pull to refresh, or check your orders."
          action={<Button label="See my orders" onPress={() => router.navigate('/orders')} />}
        />
      </Screen>
    );
  }

  const status = ISSUE_STATUS[data.status];
  const resolution = data.resolution;
  const steps: TimelineItem[] = [
    { key: 'open', label: 'Reported', at: data.statusAt.open ?? data.createdAt, state: 'done' },
    {
      key: 'in_review',
      label: 'Being reviewed by InstaSupply',
      at: data.statusAt.in_review ?? null,
      state: data.status === 'open' ? 'todo' : data.status === 'in_review' ? 'current' : 'done',
    },
    {
      key: 'resolved',
      label: 'Resolved',
      at: data.statusAt.resolved ?? null,
      state: data.status === 'resolved' ? 'done' : 'todo',
    },
  ];

  return (
    <Screen header={header} refreshing={issue.refreshing} onRefresh={issue.retry}>
      <Card style={styles.card}>
        <StatusPill label={status.label} tone={status.tone} />
        <Text variant="heading">{issueTypeLabel(data.type)}</Text>
        <Text variant="caption" color="muted">
          {data.storeOrderNumber} · {data.storeName} · reported {dayAndClock(data.createdAt, now)}
        </Text>
        {data.status !== 'resolved' ? (
          <Text variant="captionMedium" color="primaryDark">
            We aim to sort this out by {dayAndClock(data.slaDueAt, now)}.
          </Text>
        ) : null}
        <Timeline steps={steps} now={now} />
      </Card>

      {resolution ? (
        <Card style={styles.card}>
          <Text variant="heading" accessibilityRole="header">
            Resolution
          </Text>
          {resolution.kind === 'refund' ? (
            <Notice
              tone="success"
              title={`${formatMoney(resolution.refundCents)} refunded`}
              message="The refund goes back to the card you paid with."
            />
          ) : resolution.kind === 'replacement' ? (
            <Notice
              tone="success"
              title="Replacement on its way"
              message="We placed a replacement order at no charge."
            />
          ) : (
            <Notice tone="info" title="No further action" message="Our team reviewed the report." />
          )}
          {resolution.note ? <Text>{resolution.note}</Text> : null}
          {resolution.returnRequired ? (
            <Text variant="caption" color="muted">
              Please keep the item and its packaging: we will arrange the return with you.
            </Text>
          ) : null}
          {resolution.replacementOrderId ? (
            <Button
              label="View replacement order"
              variant="secondary"
              onPress={() => router.push(`/orders/${resolution.replacementOrderId}`)}
            />
          ) : null}
          <Text variant="caption" color="muted">
            {resolution.resolvedByName} · {dayAndClock(resolution.resolvedAt, now)}
          </Text>
        </Card>
      ) : (
        <Notice
          tone="warning"
          icon="package"
          message="Keep the item and its packaging until we sort it out."
        />
      )}

      <Card style={styles.card}>
        <Text variant="heading" accessibilityRole="header">
          What you reported
        </Text>
        {data.lines.map((line) => (
          <View key={line.lineId} style={styles.lineRow}>
            <Text style={styles.flex}>{line.name}</Text>
            <Text variant="bodyMedium">× {line.quantity}</Text>
          </View>
        ))}
        <Divider />
        <Text>{data.description}</Text>
        <Text variant="caption" color="muted">
          You asked for: {resolutionLabel(data.preferredResolution)}
        </Text>
        {data.photoPaths.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {data.photoPaths.map((path, index) => (
              <IssuePhoto key={path} path={path} index={index} />
            ))}
          </ScrollView>
        ) : null}
      </Card>

      <Button
        label="Open support chat"
        icon="message-circle"
        onPress={() =>
          router.push(supportHref({ kind: 'issue', id: data.id, label: `About ${data.number}` }))
        }
      />
      <Button
        label="View the order"
        variant="secondary"
        onPress={() => router.push(`/orders/${data.orderId}`)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm + 2 },
  flex: { flex: 1 },
  lineRow: { flexDirection: 'row', gap: spacing.md },
  photos: { gap: spacing.sm },
});
