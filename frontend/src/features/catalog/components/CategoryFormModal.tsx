import type { CategoryInput } from '@instasupply/api-client';
import type { Category } from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { ErrorIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { describeError } from '@/lib/api';

import { CATEGORY_ART_KEYS } from '../art';
import { normalizeHex } from '../colors';
import { updateCategory } from '../mutations';
import { ArtPicker } from './ArtPicker';
import { ColorField } from './ColorField';

interface Draft {
  name: string;
  iconKey: string;
  tint: string;
  accent: string;
  weightKg: string;
  l: string;
  w: string;
  h: string;
  synonyms: string;
  active: boolean;
}

type Errors = Partial<Record<keyof Draft | 'form', string>>;

function draftOf(category: Category): Draft {
  return {
    name: category.name,
    iconKey: category.iconKey,
    tint: category.tint,
    accent: category.accent,
    weightKg: String(category.defaultWeightKg),
    l: String(category.defaultDimsCm.l),
    w: String(category.defaultDimsCm.w),
    h: String(category.defaultDimsCm.h),
    synonyms: category.synonyms.join(', '),
    active: category.active,
  };
}

const positive = (text: string, max: number) => {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value > 0 && value <= max ? value : null;
};

/** Checks the draft and returns only the fields that changed. */
function patchOf(draft: Draft, category: Category): { patch: Partial<CategoryInput>; errors: Errors } {
  const errors: Errors = {};
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 40) errors.name = 'Enter a name of 1 to 40 characters.';
  const tint = normalizeHex(draft.tint);
  if (!tint) errors.tint = 'Enter a colour such as #FFF4E0.';
  const accent = normalizeHex(draft.accent);
  if (!accent) errors.accent = 'Enter a colour such as #B45309.';
  const weight = positive(draft.weightKg, 3000);
  if (weight === null) errors.weightKg = 'Enter a weight above 0 and up to 3,000 kg.';
  const l = positive(draft.l, 1500);
  const w = positive(draft.w, 1500);
  const h = positive(draft.h, 1500);
  if (l === null || w === null || h === null)
    errors.l = 'Enter a length, width and height above 0, up to 1,500 cm.';
  const synonyms = [
    ...new Set(
      draft.synonyms
        .split(/[,\n]/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (synonyms.some((word) => word.length > 40)) errors.synonyms = 'Keep each word under 40 characters.';

  const patch: Partial<CategoryInput> = {};
  if (Object.keys(errors).length > 0) return { patch, errors };
  if (name !== category.name) patch.name = name;
  if (draft.iconKey !== category.iconKey) patch.iconKey = draft.iconKey;
  if (tint !== category.tint) patch.tint = tint ?? category.tint;
  if (accent !== category.accent) patch.accent = accent ?? category.accent;
  if (weight !== category.defaultWeightKg) patch.defaultWeightKg = weight ?? category.defaultWeightKg;
  const dims = { l: l ?? 0, w: w ?? 0, h: h ?? 0 };
  if (JSON.stringify(dims) !== JSON.stringify(category.defaultDimsCm)) patch.defaultDimsCm = dims;
  if (JSON.stringify(synonyms) !== JSON.stringify(category.synonyms)) patch.synonyms = synonyms;
  if (draft.active !== category.active) patch.active = draft.active;
  return { patch, errors };
}

/**
 * Edit a marketplace category (staff, MARKETPLACE §9 "categories tab (defaults, synonyms)"): name,
 * icon, colours, the shipping defaults a supplier row without weight or size falls back to, the trade
 * words customers search by, and whether it is shown. The category ids are fixed in shared.
 */
export function CategoryFormModal({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category: Category;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(category));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const result = patchOf(draft, category);
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    if (Object.keys(result.patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await updateCategory(category.id, result.patch);
      toast.success(`Saved ${draft.name.trim()}`);
      onClose();
    } catch (caught) {
      setErrors({ form: describeError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const numberField = (key: 'weightKg' | 'l' | 'w' | 'h', label: string) => (
    <Field label={label} required error={key === 'weightKg' || key === 'l' ? errors[key] : undefined}>
      {(id, describedBy) => (
        <TextInput
          id={id}
          aria-describedby={describedBy}
          inputMode="decimal"
          disabled={busy}
          invalid={key === 'weightKg' ? !!errors.weightKg : !!errors.l}
          value={draft[key]}
          onChange={(event) => set(key, event.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnBackdrop={false}
      size="lg"
      title={`Edit ${category.name}`}
      description={`Category id ${category.id}. Products keep their own weight and size; these defaults fill in when a supplier leaves them empty.`}
      footer={
        <>
          {errors.form ? (
            <p className="mr-auto flex items-center gap-1.5 text-sm text-rose-700" role="alert">
              <ErrorIcon size={16} aria-hidden /> {errors.form}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save category
          </Button>
        </>
      }
    >
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required error={errors.name} className="sm:col-span-1">
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                maxLength={40}
                disabled={busy}
                invalid={!!errors.name}
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
              />
            )}
          </Field>
          <ColorField
            label="Tile colour"
            value={draft.tint}
            onChange={(value) => set('tint', value)}
            error={errors.tint}
            placeholder="#FFF4E0"
          />
          <ColorField
            label="Accent"
            value={draft.accent}
            onChange={(value) => set('accent', value)}
            error={errors.accent}
            placeholder="#B45309"
          />
        </div>
        <ArtPicker
          label="Icon"
          keys={CATEGORY_ART_KEYS}
          value={draft.iconKey}
          onChange={(key) => set('iconKey', key ?? category.iconKey)}
          tint={draft.tint}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Shipping defaults per unit</legend>
          <div className="grid gap-4 sm:grid-cols-4">
            {numberField('weightKg', 'Weight (kg)')}
            {numberField('l', 'Length (cm)')}
            {numberField('w', 'Width (cm)')}
            {numberField('h', 'Height (cm)')}
          </div>
        </fieldset>
        <Field
          label="Search words"
          error={errors.synonyms}
          hint="Comma-separated trade words customers type, e.g. “2x4, stud, spf, lumber”."
        >
          {(id, describedBy) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              disabled={busy}
              value={draft.synonyms}
              onChange={(event) => set('synonyms', event.target.value)}
            />
          )}
        </Field>
        <Toggle
          label="Shown in the app"
          description="A hidden category keeps its products, but customers can't browse it."
          checked={draft.active}
          disabled={busy}
          onChange={(value) => set('active', value)}
        />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
