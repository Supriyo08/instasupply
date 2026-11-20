import { validateUpload } from '@instasupply/api-client';
import { useApi, useLiveQuery } from '@instasupply/api-client/react';
import {
  CATEGORIES,
  SELL_UNITS,
  type Category,
  type CategoryId,
  type Product,
  type ProductBadge,
  type SellUnit,
} from '@instasupply/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { DeleteIcon, ErrorIcon, InfoIcon, UploadIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { describeError, isApiError, queries } from '@/lib/api';

import { PRODUCT_ART_KEYS } from '../art';
import { createProduct, updateProduct } from '../mutations';
import {
  draftFromProduct,
  emptyDraft,
  inputFromProduct,
  patchFrom,
  validateDraft,
  withCategoryDefaults,
  type ProductDraft,
  type ProductErrors,
} from '../product-form';
import { ArtPicker } from './ArtPicker';
import { ArtThumb } from './ArtThumb';

const UNIT_LABELS: Record<SellUnit, string> = {
  each: 'Each',
  pair: 'Pair',
  sheet: 'Sheet',
  length: 'Length',
  bundle: 'Bundle',
  box: 'Box',
  bag: 'Bag',
  pail: 'Pail',
  can: 'Can',
  tube: 'Tube',
  roll: 'Roll',
  pack: 'Pack',
  kit: 'Kit',
};

const BADGES: { value: ProductBadge | ''; label: string }[] = [
  { value: '', label: 'No badge' },
  { value: 'new', label: 'New' },
  { value: 'bestseller', label: 'Bestseller' },
  { value: 'deal', label: 'Deal' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function PhotoField({
  storeId,
  imagePath,
  imageUrl,
  artKey,
  tint,
  onChange,
}: {
  storeId: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  artKey: string | null;
  tint: string | null;
  onChange: (path: string | null) => void;
}) {
  const client = useApi();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const upload = async (file: File | undefined) => {
    if (!file || !storeId) return;
    const source = { kind: 'blob' as const, blob: file, name: file.name, contentType: file.type };
    const problem = validateUpload('product_photo', source);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await client.upload({ purpose: 'product_photo', ownerId: storeId, source });
      setPreview(URL.createObjectURL(file));
      onChange(uploaded.path);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const shown = imagePath ? (preview ?? imageUrl) : null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">Photo</p>
      <div className="flex items-center gap-4">
        <ArtThumb artKey={artKey} imageUrl={shown} tint={tint} size="xl" />
        <div className="space-y-2">
          <label
            className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-300 ring-inset hover:bg-slate-50 ${!storeId || busy ? 'pointer-events-none opacity-50' : ''}`}
          >
            <UploadIcon size={16} aria-hidden />
            {busy ? 'Uploading…' : imagePath ? 'Replace photo' : 'Upload photo'}
            <input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              disabled={!storeId || busy}
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {imagePath ? (
            <Button size="sm" variant="ghost" icon={DeleteIcon} onClick={() => onChange(null)}>
              Remove photo
            </Button>
          ) : null}
          <p className="text-xs text-slate-500">
            {storeId
              ? 'JPEG, PNG or WebP up to 5 MB. Without a photo the illustration is shown.'
              : 'Choose the store first.'}
          </p>
        </div>
      </div>
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

/**
 * Add or edit one product (MARKETPLACE §8): every product field, the SKU fixed after creation, weight
 * and size prefilled from the category with an "Estimated" checkbox, a photo upload to
 * `productPhotos/{storeId}/` that sets `imagePath`, and an illustration as the fallback. Staff also
 * see `featured`, `badge` and `familyKey`. An edit sends only the fields that changed.
 */
export function ProductFormModal({
  open,
  onClose,
  product,
  storeId,
  staff,
  defaultCategoryId,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  /** Null to add a product. */
  product: Product | null;
  /** The store a new product goes into; null lets staff choose. */
  storeId: string | null;
  staff: boolean;
  defaultCategoryId: CategoryId | '';
  categories: readonly Category[];
}) {
  const toast = useToast();
  const editing = product !== null;
  const [draft, setDraft] = useState<ProductDraft>(() =>
    product ? draftFromProduct(product) : emptyDraft(defaultCategoryId),
  );
  const [chosenStore, setChosenStore] = useState<string>(product?.storeId ?? storeId ?? '');
  const [errors, setErrors] = useState<ProductErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stores = useLiveQuery(queries.stores(), { enabled: staff && !storeId && !editing });

  const targetStore = product?.storeId ?? (storeId || chosenStore || null);
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const category = draft.categoryId ? CATEGORIES[draft.categoryId] : null;

  const save = async () => {
    setFormError(null);
    if (!targetStore) {
      setFormError('Choose the store this product belongs to.');
      return;
    }
    const result = validateDraft(draft, targetStore, staff);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(result.errors.form ?? 'Check the highlighted fields.');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (product) {
        const patch = patchFrom(result.value, inputFromProduct(product, staff));
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        await updateProduct(product.id, patch);
        toast.success(`Saved ${result.value.name}`);
      } else {
        await createProduct(targetStore, result.value);
        toast.success(
          `Added ${result.value.name}`,
          'It is listed for sale once it is active and the store is live.',
        );
      }
      onClose();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 'already-exists') {
        setErrors({ sku: 'That SKU is already in this store’s catalogue. Edit that product instead.' });
        setFormError('Check the highlighted fields.');
      } else {
        setFormError(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const text = (
    key: keyof ProductDraft & keyof ProductErrors,
    label: string,
    options: {
      required?: boolean;
      hint?: string;
      inputMode?: 'decimal' | 'numeric';
      disabled?: boolean;
      placeholder?: string;
    } = {},
  ) => (
    <Field label={label} required={options.required} error={errors[key]} hint={options.hint}>
      {(id, describedBy) => (
        <TextInput
          id={id}
          aria-describedby={describedBy}
          inputMode={options.inputMode}
          placeholder={options.placeholder}
          disabled={busy || options.disabled}
          invalid={!!errors[key]}
          value={String(draft[key] ?? '')}
          onChange={(event) => set(key, event.target.value as never)}
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
      size="xl"
      title={editing ? `Edit ${product.name}` : 'Add a product'}
      description={
        editing
          ? `SKU ${product.sku} · ${product.storeName}`
          : 'Customers see it in search and on your store page.'
      }
      footer={
        <>
          {formError ? (
            <p className="mr-auto flex items-center gap-1.5 text-sm text-rose-700" role="alert">
              <ErrorIcon size={16} aria-hidden /> {formError}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {editing ? 'Save product' : 'Add product'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {staff && !storeId && !editing ? (
          <Field label="Store" required>
            {(id) => (
              <Select
                id={id}
                value={chosenStore}
                disabled={busy}
                onChange={(event) => setChosenStore(event.target.value)}
              >
                <option value="" disabled>
                  Choose a store
                </option>
                {stores.data
                  .filter((item) => item.status !== 'closed')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Section title="Listing">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('name', 'Name', { required: true, placeholder: 'NMD90 14/2 cable, 75 m' })}
            {text('sku', 'SKU', {
              required: true,
              disabled: editing,
              hint: editing
                ? 'Fixed: the SKU is part of the product id.'
                : 'Your own code. It cannot change later.',
            })}
            {text('brand', 'Brand', { placeholder: 'Southwire' })}
            {text('size', 'Size', {
              placeholder: '2 in × 4 in × 8 ft',
              hint: 'The trade size as it is written on the tag.',
            })}
            <Field label="Category" required error={errors.categoryId}>
              {(id, describedBy) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  disabled={busy}
                  value={draft.categoryId}
                  onChange={(event) => {
                    const next = event.target.value as CategoryId;
                    setDraft((current) => (next ? withCategoryDefaults(current, next) : current));
                  }}
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Sold by" required error={errors.unit}>
              {(id, describedBy) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  disabled={busy}
                  value={draft.unit}
                  onChange={(event) => set('unit', event.target.value as SellUnit)}
                >
                  {SELL_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {UNIT_LABELS[unit]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Description" error={errors.description} hint="Up to 2,000 characters.">
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                maxLength={2000}
                disabled={busy}
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            )}
          </Field>
        </Section>

        <Section title="Price and stock">
          <div className="grid gap-4 sm:grid-cols-4">
            {text('price', 'Price ($)', { required: true, inputMode: 'decimal', placeholder: '12.99' })}
            {text('compareAt', 'Was ($)', {
              inputMode: 'decimal',
              hint: 'Strike-through price, above the price.',
            })}
            {editing ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-slate-700">On hand</p>
                <p className="flex h-9 items-center text-sm text-slate-900 tabular-nums">
                  {product.stockOnHand}
                </p>
                <p className="text-xs text-slate-500">Change counts from the table.</p>
              </div>
            ) : (
              text('stockOnHand', 'On hand', {
                required: true,
                inputMode: 'numeric',
                hint: 'What is on your shelf now.',
              })
            )}
            {text('maxPerOrder', 'Limit per order', { inputMode: 'numeric', hint: 'Empty for no limit.' })}
          </div>
          <Toggle
            label="For sale"
            description="Inactive products stay in your catalogue but customers can't order them."
            checked={draft.active}
            disabled={busy}
            onChange={(value) => set('active', value)}
          />
        </Section>

        <Section title="Shipping size">
          <p className="text-sm text-slate-600">
            Per {UNIT_LABELS[draft.unit].toLowerCase()}. Drivers and vehicle classes are picked from these
            numbers.
          </p>
          <div className="grid gap-4 sm:grid-cols-4">
            {text('weightKg', 'Weight (kg)', { required: true, inputMode: 'decimal' })}
            <Field label="Length (cm)" required error={errors.dimsCm}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="decimal"
                  disabled={busy}
                  invalid={!!errors.dimsCm}
                  value={draft.lengthCm}
                  onChange={(event) => set('lengthCm', event.target.value)}
                />
              )}
            </Field>
            <Field label="Width (cm)" required>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  disabled={busy}
                  value={draft.widthCm}
                  onChange={(event) => set('widthCm', event.target.value)}
                />
              )}
            </Field>
            <Field label="Height (cm)" required>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  disabled={busy}
                  value={draft.heightCm}
                  onChange={(event) => set('heightCm', event.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-brand-600"
                checked={draft.shipEstimated}
                disabled={busy}
                onChange={(event) => set('shipEstimated', event.target.checked)}
              />
              Estimated (from the category, not measured)
            </label>
            {category ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setDraft((current) =>
                    withCategoryDefaults(
                      { ...current, weightKg: '', lengthCm: '', widthCm: '', heightCm: '' },
                      category.id,
                    ),
                  )
                }
              >
                Use {category.name} defaults
              </Button>
            ) : null}
          </div>
        </Section>

        <Section title="Picture">
          <PhotoField
            storeId={targetStore}
            imagePath={draft.imagePath}
            imageUrl={product?.imagePath === draft.imagePath ? (product?.imageUrl ?? null) : null}
            artKey={draft.imageKey ?? category?.iconKey ?? null}
            tint={category?.tint ?? null}
            onChange={(path) => set('imagePath', path)}
          />
          <ArtPicker
            label="Illustration"
            keys={PRODUCT_ART_KEYS}
            value={draft.imageKey}
            onChange={(key) => set('imageKey', key)}
            tint={category?.tint}
            noneLabel="Category icon"
            error={errors.imageKey}
            hint="Shown when there is no photo."
          />
        </Section>

        {staff ? (
          <Section title="InstaSupply only">
            <Callout tone="info" icon={InfoIcon}>
              Suppliers don&apos;t see these fields.
            </Callout>
            <div className="grid gap-4 sm:grid-cols-3">
              <Toggle
                label="Featured"
                description="On the home screen of the app."
                checked={draft.featured}
                disabled={busy}
                onChange={(value) => set('featured', value)}
              />
              <Field label="Badge" error={errors.badge}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={busy}
                    value={draft.badge}
                    onChange={(event) => set('badge', event.target.value as ProductBadge | '')}
                  >
                    {BADGES.map((badge) => (
                      <option key={badge.value} value={badge.value}>
                        {badge.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {text('familyKey', 'Family key', {
                hint: 'Same key across stores groups offers: “2 stores · from $4.79”.',
                placeholder: 'stud-2x4-8-spf',
              })}
            </div>
          </Section>
        ) : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
