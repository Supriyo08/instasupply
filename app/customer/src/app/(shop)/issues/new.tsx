import { describeError } from '@instasupply/api-client';
import {
  canReportIssue,
  validateIssueReport,
  type Issue,
  type IssueType,
  type StoreOrder,
} from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  Notice,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import { FormSection } from '@/features/account/FormSection';
import { IssueLinePicker } from '@/features/issues/components/IssueLinePicker';
import { UploadList } from '@/features/issues/components/UploadList';
import { reportIssue } from '@/features/issues/hooks';
import { ISSUE_TYPES, MAX_ISSUE_PHOTOS, needsPhoto, RESOLUTIONS } from '@/features/issues/issue-format';
import { useUploadQueue } from '@/features/issues/useUploadQueue';
import { useStoreOrder } from '@/features/orders/hooks';
import { firstParam } from '@/features/orders/params';
import { RequireAccount } from '@/features/session/RequireAccount';
import { pickPhotos } from '@/features/uploads/pick';
import { useNow } from '@/hooks/useNow';
import { newRequestId } from '@/lib/ids';
import { spacing } from '@/theme/tokens';

/** Report a problem 🔒 (MARKETPLACE §7.3 issues/new, `?storeOrderId=`; CLIENTS §4.3). */
export default function NewIssueScreen() {
  return (
    <RequireAccount title="Report a problem">
      <NewIssueBody />
    </RequireAccount>
  );
}

function NewIssueBody() {
  const storeOrderId = firstParam(useLocalSearchParams<{ storeOrderId?: string }>().storeOrderId);
  const storeOrder = useStoreOrder(storeOrderId);
  const now = useNow(60_000);
  const header = <Header title="Report a problem" />;

  if (storeOrder.loading && !storeOrder.data) {
    return (
      <Screen header={header}>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (storeOrder.error && !storeOrder.data) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load the order" error={storeOrder.error} onRetry={storeOrder.retry} />
      </Screen>
    );
  }
  if (!storeOrder.data) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-report-issue"
          title="Choose an order first"
          message="Open the order on the Orders tab and tap Report a problem on the store's card."
          action={<Button label="See my orders" onPress={() => router.navigate('/orders')} />}
        />
      </Screen>
    );
  }
  if (!canReportIssue(storeOrder.data, now)) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-report-issue"
          title="This can't be reported here any more"
          message="Problems can be reported up to 48 hours after delivery or pickup. Our support team can still help."
          action={<Button label="Chat with support" onPress={() => router.replace('/support')} />}
        />
      </Screen>
    );
  }
  return <IssueForm storeOrder={storeOrder.data} />;
}

function IssueForm({ storeOrder }: { storeOrder: StoreOrder }) {
  // Created when the screen opens and kept across retries: a retry never opens a second case (D17).
  const [issueId] = useState(() => newRequestId());
  const photos = useUploadQueue('issue_photo', issueId, MAX_ISSUE_PHOTOS);
  const [type, setType] = useState<IssueType | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState<Issue['preferredResolution'] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const addPhotos = async (camera: boolean) => {
    const picked = await pickPhotos({ camera, max: MAX_ISSUE_PHOTOS - photos.files.length });
    if (picked.status === 'denied') setErrors((current) => ({ ...current, photoPaths: picked.message }));
    if (picked.status !== 'picked') return;
    const problem = photos.add(picked.sources);
    setErrors((current) => ({ ...current, photoPaths: problem ?? undefined }));
  };

  const submit = async () => {
    if (photos.uploading) {
      setErrors({ form: 'Wait for the photos to finish uploading.' });
      return;
    }
    if (photos.failed) {
      setErrors({ form: 'Retry or remove the photos that did not upload.' });
      return;
    }
    const raw = {
      type,
      lines: Object.entries(chosen).map(([lineId, quantity]) => ({ lineId, quantity })),
      description,
      photoPaths: photos.files.flatMap((file) => (file.path ? [file.path] : [])),
      preferredResolution: resolution,
    };
    const checked = validateIssueReport(raw, storeOrder);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await reportIssue({ issueId, storeOrderId: storeOrder.id, ...checked.value });
      router.replace(`/issues/${issueId}`);
    } catch (error) {
      setErrors({ form: describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title="Report a problem" />}
      footer={<Button label="Send report" loading={busy} onPress={() => void submit()} />}
    >
      <Text color="muted">
        {storeOrder.number} · {storeOrder.storeName}
      </Text>
      <FormSection title="What went wrong?">
        <View style={styles.chips}>
          {ISSUE_TYPES.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={type === option.value}
              onPress={() => setType(option.value)}
            />
          ))}
        </View>
        {errors.type ? <FieldError message={errors.type} /> : null}
      </FormSection>
      <FormSection title="Which items?" subtitle="Choose the items and how many have the problem.">
        <IssueLinePicker lines={storeOrder.lines} chosen={chosen} onChange={setChosen} />
        {errors.lines ? <FieldError message={errors.lines} /> : null}
      </FormSection>
      <FormSection
        title="Photos"
        subtitle={
          needsPhoto(type)
            ? 'Add at least one photo of the damaged or wrong item.'
            : `Optional, up to ${MAX_ISSUE_PHOTOS}. Photos help us sort it out faster.`
        }
      >
        <UploadList files={photos.files} onRetry={photos.retry} onRemove={photos.remove} />
        {!photos.full ? (
          <View style={styles.row}>
            <Button
              label="Take photo"
              icon="camera"
              variant="secondary"
              size="md"
              style={styles.half}
              onPress={() => void addPhotos(true)}
            />
            <Button
              label="Choose photos"
              icon="image"
              variant="secondary"
              size="md"
              style={styles.half}
              onPress={() => void addPhotos(false)}
            />
          </View>
        ) : null}
        {errors.photoPaths ? <FieldError message={errors.photoPaths} /> : null}
      </FormSection>
      <FormSection title="Describe the problem">
        <Input
          multiline
          tone="default"
          placeholder="e.g. 3 sheets of drywall have crushed corners"
          value={description}
          onChangeText={setDescription}
          maxLength={1000}
          error={errors.description}
          accessibilityLabel="Describe the problem"
        />
      </FormSection>
      <FormSection title="What would you like?">
        <View style={styles.chips}>
          {RESOLUTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={resolution === option.value}
              onPress={() => setResolution(option.value)}
            />
          ))}
        </View>
        {errors.preferredResolution ? <FieldError message={errors.preferredResolution} /> : null}
      </FormSection>
      <Notice tone="warning" icon="package" message="Keep the item and its packaging until we sort it out." />
      {errors.form ? <Notice tone="danger" message={errors.form} /> : null}
    </Screen>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <Text variant="caption" color="danger" accessibilityRole="alert">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  half: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  skeleton: { height: 120 },
});
