import {
  ORDER_PROGRESS,
  ORDER_STATUS_META,
  formatDateTime,
  type Order,
  type OrderStatus,
} from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { STATUS_ICONS, reachedStepIndex } from './order-ui';
import { Pulse } from './Pulse';

type StepState = 'done' | 'current' | 'pending' | 'failed' | 'cancelled';

interface Step {
  status: OrderStatus;
  state: StepState;
  detail: string;
  note: string | null;
}

const CIRCLE = 46;

const PALETTE: Record<StepState, { bg: string; fg: string }> = {
  done: { bg: colors.primarySoft, fg: colors.primary },
  current: { bg: colors.primary, fg: colors.white },
  pending: { bg: colors.background, fg: colors.textSubtle },
  failed: { bg: colors.dangerSoft, fg: colors.danger },
  cancelled: { bg: colors.background, fg: colors.textMuted },
};

const SPOKEN_STATE: Record<StepState, string> = {
  done: 'completed',
  current: 'current status',
  pending: 'pending',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** Progress steps plus a failed / cancelled step where the order stopped. */
function buildSteps(order: Order): Step[] {
  const reached = reachedStepIndex(order);
  const terminal = order.status === 'failed' || order.status === 'cancelled';
  const timeOf = (status: OrderStatus) => {
    const at = order.statusAt?.[status] ?? (status === 'placed' ? order.createdAt : null);
    return at ? formatDateTime(at) : null;
  };

  const steps: Step[] = [];
  ORDER_PROGRESS.forEach((status, index) => {
    if (order.status === 'cancelled' && index > reached) return;
    if (index < reached || (index === reached && terminal)) {
      steps.push({ status, state: 'done', detail: timeOf(status) ?? 'Completed', note: null });
    } else if (index === reached) {
      const note = status === 'delivered' ? null : ORDER_STATUS_META[status].description;
      steps.push({ status, state: 'current', detail: timeOf(status) ?? 'In progress', note });
    } else {
      steps.push({ status, state: 'pending', detail: 'Pending', note: null });
    }
    if (index === reached && terminal) {
      steps.push({
        status: order.status,
        state: order.status === 'failed' ? 'failed' : 'cancelled',
        detail: timeOf(order.status) ?? '—',
        note:
          (order.status === 'cancelled' ? order.cancelReason : null) ??
          ORDER_STATUS_META[order.status].description,
      });
    }
  });
  return steps;
}

function connectorColor(state: StepState | undefined): string {
  if (state === 'done' || state === 'current') return colors.primary;
  if (state === 'failed') return colors.danger;
  return colors.border;
}

/** Vertical "Track Order" timeline from the Big Cart design, with times from order.statusAt. */
export function OrderTimeline({ order }: { order: Order }) {
  const steps = buildSteps(order);
  const live = order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'failed';
  return (
    <Card padded={false} style={styles.card}>
      {steps.map((step, index) => (
        <TimelineRow
          key={step.status}
          step={step}
          first={index === 0}
          next={steps[index + 1]}
          pulse={live && step.state === 'current'}
        />
      ))}
    </Card>
  );
}

function TimelineRow({
  step,
  first,
  next,
  pulse,
}: {
  step: Step;
  first: boolean;
  next: Step | undefined;
  pulse: boolean;
}) {
  const palette = PALETTE[step.state];
  const title = step.status === 'cancelled' ? 'Order cancelled' : ORDER_STATUS_META[step.status].label;
  const pending = step.state === 'pending';
  const spoken = pending
    ? `${title}, pending`
    : `${title}, ${SPOKEN_STATE[step.state]}, ${step.detail}${step.note ? `. ${step.note}` : ''}`;

  return (
    <View style={styles.row} accessible accessibilityLabel={spoken}>
      <View style={styles.rail}>
        <View
          style={[styles.lineTop, { backgroundColor: first ? 'transparent' : connectorColor(step.state) }]}
        />
        <View style={styles.circleWrap}>
          {pulse ? <Pulse size={CIRCLE} color={colors.primary} scaleTo={1.45} /> : null}
          <View style={[styles.circle, { backgroundColor: palette.bg }]}>
            <Icon name={STATUS_ICONS[step.status]} size={20} color={palette.fg} />
          </View>
        </View>
        <View
          style={[styles.lineBottom, { backgroundColor: next ? connectorColor(next.state) : 'transparent' }]}
        />
      </View>
      <View style={[styles.content, next ? styles.divider : null]}>
        <Text variant="bodyMedium" color={pending ? 'muted' : 'default'}>
          {title}
        </Text>
        <Text variant="caption" color={pending ? 'subtle' : 'muted'}>
          {step.detail}
        </Text>
        {step.note ? (
          <Text
            variant="caption"
            style={{ color: step.state === 'failed' ? colors.danger : colors.primaryDark }}
          >
            {step.note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const LINE_TOP = 14;

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.xs },
  circle: {
    alignItems: 'center',
    borderRadius: CIRCLE / 2,
    height: CIRCLE,
    justifyContent: 'center',
    width: CIRCLE,
  },
  circleWrap: { alignItems: 'center', height: CIRCLE, justifyContent: 'center', width: CIRCLE },
  content: { flex: 1, gap: 1, minHeight: LINE_TOP * 2 + CIRCLE, paddingBottom: 18, paddingTop: 17 },
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  lineBottom: { flex: 1, minHeight: LINE_TOP, width: 2 },
  lineTop: { height: LINE_TOP, width: 2 },
  rail: { alignItems: 'center', width: CIRCLE },
  row: { flexDirection: 'row', gap: 14, paddingHorizontal: spacing.lg },
});
