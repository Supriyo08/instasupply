import { describeError } from '@instasupply/api-client';
import {
  addLocalDays,
  formatDayET,
  fromLocal,
  localDateOf,
  validateMaterialList,
  type Fulfilment,
  type QuoteRequest,
} from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  EmptyState,
  Header,
  Input,
  Notice,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { FormSection } from '@/features/account/FormSection';
import { UploadList } from '@/features/issues/components/UploadList';
import { useUploadQueue } from '@/features/issues/useUploadQueue';
import { dayAndClock } from '@/features/orders/order-format';
import { MaterialLinesEditor } from '@/features/quotes/components/MaterialLinesEditor';
import { submitMaterialList } from '@/features/quotes/hooks';
import { initialDraftLines, requestLines, type DraftLine } from '@/features/quotes/list-lines';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useJobsites } from '@/features/site/hooks';
import { useStore } from '@/features/stores/hooks';
import { pickDocuments, pickPhotos } from '@/features/uploads/pick';
import { useNow } from '@/hooks/useNow';
import { newRequestId } from '@/lib/ids';
import { spacing } from '@/theme/tokens';

const MAX_FILES = 5;
type NeededKind = QuoteRequest['neededBy']['kind'];
type ContactWay = QuoteRequest['contact']['preferred'];

const NEEDED: { value: NeededKind; label: string }[] = [
  { value: 'asap', label: 'ASAP' },
  { value: 'this_week', label: 'This week' },
  { value: 'date', label: 'Pick a date' },
];
const CONTACT: { value: ContactWay; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
];
const FULFILMENT = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'pickup', label: 'Pickup' },
] as const;

/** Send us your material list 🔒 (MARKETPLACE §7.3 quotes/new; CLIENTS §4.3). */
export default function NewQuoteScreen() {
  return (
    <RequireAccount title="Material list">
      <NewQuoteBody />
    </RequireAccount>
  );
}

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function NewQuoteBody() {
  const { user, profile } = useCustomer();
  // The cart's "Send as a material list" opens this form with `?items=` (one per line) and `?storeId=`.
  const params = useLocalSearchParams<{ items?: string; storeId?: string }>();
  const fromStoreId = single(params.storeId) ?? null;
  const fromStore = useStore(fromStoreId);
  const jobsites = useJobsites(user.uid);
  const now = useNow(60_000);
  // The quote id: created once, kept across retries, so a lost answer never makes a second quote.
  const [requestId] = useState(() => newRequestId());
  const files = useUploadQueue('quote_upload', requestId, MAX_FILES);
  const counter = useRef(0);
  const newKey = () => `line-${(counter.current += 1)}`;
  const [lines, setLines] = useState<DraftLine[]>(() => initialDraftLines(single(params.items), newKey));
  const [neededKind, setNeededKind] = useState<NeededKind>('asap');
  const [neededDate, setNeededDate] = useState<string | null>(null);
  const [fulfilment, setFulfilment] = useState<Fulfilment>('delivery');
  const [jobsiteId, setJobsiteId] = useState<string | null>(null);
  const [contactWay, setContactWay] = useState<ContactWay>('call');
  const [phone, setPhone] = useState(profile.phoneNumber ?? '');
  const [email, setEmail] = useState(profile.email ?? user.email ?? '');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  // Name the store the list came from in the notes, once, unless the customer already typed some.
  const storeName = fromStore.data?.name ?? null;
  const notedStore = useRef(false);
  useEffect(() => {
    if (!storeName || notedStore.current) return;
    notedStore.current = true;
    setNotes((current) => current || `From my cart at ${storeName}.`);
  }, [storeName]);
  const [sent, setSent] = useState<{ quoteId: string; number: string; respondBy: number } | null>(null);

  const site = jobsiteId ?? jobsites.defaultJobsite?.id ?? null;
  const today = localDateOf(now);
  const dates = Array.from({ length: 14 }, (_, index) => addLocalDays(today, index + 1));

  const attach = async (kind: 'camera' | 'files') => {
    const room = MAX_FILES - files.files.length;
    const picked =
      kind === 'camera' ? await pickPhotos({ camera: true, max: room }) : await pickDocuments({ max: room });
    if (picked.status === 'denied') setErrors((current) => ({ ...current, attachments: picked.message }));
    if (picked.status !== 'picked') return;
    setErrors((current) => ({ ...current, attachments: files.add(picked.sources) ?? undefined }));
  };

  const submit = async () => {
    if (files.uploading) return setErrors({ form: 'Wait for your files to finish uploading.' });
    if (files.failed) return setErrors({ form: 'Retry or remove the files that did not upload.' });
    const raw = {
      lines: requestLines(lines),
      attachments: files.files.flatMap((file) =>
        file.path
          ? [{ path: file.path, name: file.name, contentType: file.contentType, sizeBytes: file.sizeBytes }]
          : [],
      ),
      neededBy: { kind: neededKind, date: neededKind === 'date' ? neededDate : null },
      fulfilment,
      jobsiteId: site,
      contact: { preferred: contactWay, phone: phone.trim() || null, email: email.trim() || null },
      notes: notes.trim() || null,
    };
    const checked = validateMaterialList(raw);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setBusy(true);
    try {
      const result = await submitMaterialList({ requestId, ...checked.value });
      setSent(result);
    } catch (error) {
      setErrors({ form: describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen header={<Header title="Material list" />}>
        <EmptyState
          art="scene-material-list"
          title="Material list received"
          message={`Expect a quote within 30 minutes during business hours: by ${dayAndClock(sent.respondBy, now)}. We'll notify you when ${sent.number} is ready.`}
          action={
            <View style={styles.actions}>
              <Button label="View my list" onPress={() => router.replace(`/quotes/${sent.quoteId}`)} />
              <Button label="Back to shopping" variant="secondary" onPress={() => router.navigate('/')} />
            </View>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title="Material list" />}
      footer={<Button label="Send my list" loading={busy} onPress={() => void submit()} />}
    >
      <View style={styles.intro}>
        <Text variant="title">Send us your material list</Text>
        <Text color="muted">Type it, paste it, or upload a photo. We price it with local suppliers.</Text>
      </View>
      <FormSection title="Items" subtitle="Paste several lines and we split them into items.">
        <MaterialLinesEditor lines={lines} onChange={setLines} newKey={newKey} />
        {errors.lines ? <FieldError message={errors.lines} /> : null}
      </FormSection>
      <FormSection
        title="Attachments"
        subtitle={`Photo, PDF or spreadsheet · up to ${MAX_FILES} files, 15 MB each.`}
      >
        <UploadList files={files.files} onRetry={files.retry} onRemove={files.remove} />
        {!files.full ? (
          <View style={styles.row}>
            <Button
              label="Take photo"
              icon="camera"
              variant="secondary"
              size="md"
              style={styles.half}
              onPress={() => void attach('camera')}
            />
            <Button
              label="Attach file"
              icon="paperclip"
              variant="secondary"
              size="md"
              style={styles.half}
              onPress={() => void attach('files')}
            />
          </View>
        ) : null}
        {errors.attachments ? <FieldError message={errors.attachments} /> : null}
      </FormSection>
      <FormSection title="Needed by">
        <View style={styles.chips}>
          {NEEDED.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={neededKind === option.value}
              onPress={() => setNeededKind(option.value)}
            />
          ))}
        </View>
        {neededKind === 'date' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dates}>
            {dates.map((date) => (
              <Chip
                key={date}
                label={formatDayET(fromLocal(date, 12 * 60), now)}
                selected={neededDate === date}
                onPress={() => setNeededDate(date)}
              />
            ))}
          </ScrollView>
        ) : null}
        {errors.neededBy ? <FieldError message={errors.neededBy} /> : null}
      </FormSection>
      <FormSection title="Delivery or pickup">
        <SegmentedControl options={FULFILMENT} value={fulfilment} onChange={setFulfilment} />
        {jobsites.data.length > 0 ? (
          <View style={styles.chips}>
            {jobsites.data.map((jobsite) => (
              <Chip
                key={jobsite.id}
                icon="map-pin"
                label={jobsite.label}
                selected={site === jobsite.id}
                onPress={() => setJobsiteId(jobsite.id)}
              />
            ))}
          </View>
        ) : (
          <Notice
            tone={fulfilment === 'delivery' ? 'warning' : 'info'}
            message={
              fulfilment === 'delivery'
                ? 'Add the jobsite to deliver to.'
                : 'Add a jobsite so we can find the nearest stores.'
            }
            actionLabel="Add jobsite"
            onAction={() => router.push('/jobsites/edit')}
          />
        )}
        {errors.jobsiteId ? <FieldError message={errors.jobsiteId} /> : null}
      </FormSection>
      <FormSection title="How should we reach you?">
        <View style={styles.chips}>
          {CONTACT.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={contactWay === option.value}
              onPress={() => setContactWay(option.value)}
            />
          ))}
        </View>
        {contactWay === 'email' ? (
          <Input
            icon="mail"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            accessibilityLabel="Email"
          />
        ) : (
          <Input
            icon="phone"
            placeholder="(416) 555-0110"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            accessibilityLabel="Phone number"
          />
        )}
        {errors.contact ? <FieldError message={errors.contact} /> : null}
      </FormSection>
      <FormSection title="Notes">
        <Input
          multiline
          placeholder="Brands you prefer, substitutes that are OK, gate code…"
          value={notes}
          onChangeText={setNotes}
          maxLength={1000}
          error={errors.notes}
          accessibilityLabel="Notes"
        />
      </FormSection>
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
  actions: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dates: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  intro: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.md },
});
