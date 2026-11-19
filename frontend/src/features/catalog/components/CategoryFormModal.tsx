import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/firebase/callables';

import { CATEGORY_ART_KEYS } from '../art';
import {
  CATEGORY_ID_MAX,
  CATEGORY_NAME_MAX,
  categoryChanges,
  categoryToDraft,
  DEFAULT_ACCENT,
  DEFAULT_TINT,
  emptyCategoryDraft,
  nextSortOrder,
  normalizeHex,
  suggestCategoryId,
  validateCategoryDraft,
  type CategoryDraft,
  type CategoryErrors,
} from '../category-form';
import type { CategoryRecord, ProductRecord } from '../hooks';
import { createCategory, refreshSearchTerms, updateCategory } from '../mutations';
import { ArtPicker } from './ArtPicker';
import { ArtThumb } from './ArtThumb';
import { ColorField } from './ColorField';

/** Create a category (`category` null) or edit one. Mount with a fresh `key` per opening. */
export function CategoryFormModal({
  open,
  category,
  categories,
  products,
  onClose,
}: {
  open: boolean;
  category: CategoryRecord | null;
  categories: CategoryRecord[];
  products: ProductRecord[];
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const [draft, setDraft] = useState<CategoryDraft>(() =>
    category
      ? categoryToDraft(category)
      : emptyCategoryDraft(nextSortOrder(categories), CATEGORY_ART_KEYS[0] ?? ''),
  );
  // On create the id follows the name until it is edited by hand.
  const [idTouched, setIdTouched] = useState(false);
  const [errors, setErrors] = useState<CategoryErrors>({});
  const [saving, setSaving] = useState(false);

  const patch = (change: Partial<CategoryDraft>) => setDraft((current) => ({ ...current, ...change }));

  const save = async () => {
    const result = validateCategoryDraft(draft, {
      existing: category,
      takenIds: new Set(categories.map((item) => item.id)),
      iconKeys: CATEGORY_ART_KEYS,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const { id, value } = result;
    setErrors({});
    setSaving(true);
    try {
      if (category) {
        const changes = categoryChanges(category, value);
        if (Object.keys(changes).length === 0) {
          toast.info('No changes to save');
          onClose();
          return;
        }
        await updateCategory(category.id, changes);
        toast.success(`${value.name} saved`);
        if (changes.name !== undefined) {
          const members = products.filter((product) => product.categoryId === category.id);
          try {
            await refreshSearchTerms(members, value.name);
          } catch (error) {
            toast.error(
              "Product search wasn't updated",
              `Shoppers may not find these products by the new name yet. ${errorMessage(error)}`,
            );
          }
        }
      } else {
        await createCategory(id, value);
        toast.success(`${value.name} added`);
      }
      onClose();
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const tint = normalizeHex(draft.tint);
  const accent = normalizeHex(draft.accent);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={category ? `Edit ${category.name}` : 'New category'}
      description="Categories group products in the shop, in the order shown here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {category ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {errors.form ? (
          <Callout tone="warning" icon={WarningIcon}>
            {errors.form}
          </Callout>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <div className="min-w-0 space-y-4">
            <Field label="Name" required error={errors.name}>
              {(fieldId, describedBy) => (
                <TextInput
                  id={fieldId}
                  aria-describedby={describedBy}
                  value={draft.name}
                  invalid={!!errors.name}
                  maxLength={CATEGORY_NAME_MAX}
                  placeholder="Dairy & eggs"
                  onChange={(event) => {
                    const name = event.target.value;
                    patch(category || idTouched ? { name } : { name, id: suggestCategoryId(name) });
                  }}
                />
              )}
            </Field>
            <Field
              label="ID"
              required={!category}
              error={errors.id}
              hint={
                category
                  ? "Products and shop links refer to it, so it can't change."
                  : 'Used in links. Lowercase letters, numbers and hyphens.'
              }
            >
              {(fieldId, describedBy) => (
                <TextInput
                  id={fieldId}
                  aria-describedby={describedBy}
                  value={draft.id}
                  invalid={!!errors.id}
                  disabled={!!category}
                  maxLength={CATEGORY_ID_MAX}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="dairy-and-eggs"
                  className="font-mono"
                  onChange={(event) => {
                    setIdTouched(true);
                    patch({ id: event.target.value.toLowerCase().replace(/\s+/g, '-') });
                  }}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
            <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Preview</span>
            <ArtThumb artKey={draft.iconKey} tint={tint} size="lg" shape="circle" />
            <span className="max-w-full truncate text-xs font-medium text-slate-700">
              {draft.name.trim() || 'Category'}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <span
                className="size-2.5 rounded-full ring-1 ring-slate-900/10 ring-inset"
                style={{ backgroundColor: accent ?? DEFAULT_ACCENT }}
                aria-hidden
              />
              Accent
            </span>
          </div>
        </div>

        <ArtPicker
          label="Icon"
          keys={CATEGORY_ART_KEYS}
          value={draft.iconKey || null}
          tint={tint}
          error={errors.iconKey}
          onChange={(iconKey) => patch({ iconKey: iconKey ?? '' })}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <ColorField
            label="Tint"
            value={draft.tint}
            error={errors.tint}
            hint="Background behind the icon."
            placeholder={DEFAULT_TINT}
            onChange={(value) => patch({ tint: value })}
          />
          <ColorField
            label="Accent"
            value={draft.accent}
            error={errors.accent}
            hint="Highlight colour."
            placeholder={DEFAULT_ACCENT}
            onChange={(value) => patch({ accent: value })}
          />
          <Field label="Sort order" required error={errors.sortOrder} hint="Lower numbers come first.">
            {(fieldId, describedBy) => (
              <TextInput
                id={fieldId}
                type="number"
                inputMode="numeric"
                step={1}
                aria-describedby={describedBy}
                value={draft.sortOrder}
                invalid={!!errors.sortOrder}
                onChange={(event) => patch({ sortOrder: event.target.value })}
              />
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}
