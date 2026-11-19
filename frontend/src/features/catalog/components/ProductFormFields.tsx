import { Field, Segmented, Select, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { cn } from '@/lib/cn';

import { PRODUCT_ART_KEYS } from '../art';
import type { CategoryRecord } from '../hooks';
import {
  BADGE_OPTIONS,
  DESCRIPTION_MAX,
  IMAGE_URL_MAX,
  NAME_MAX,
  PRICE_MAX,
  STOCK_MAX,
  UNIT_MAX,
  type ProductDraft,
  type ProductErrors,
} from '../product-form';
import { ArtPicker } from './ArtPicker';

export function ProductFormFields({
  draft,
  errors,
  categories,
  onChange,
}: {
  draft: ProductDraft;
  errors: ProductErrors;
  categories: CategoryRecord[];
  onChange: (patch: Partial<ProductDraft>) => void;
}) {
  const category = categories.find((item) => item.id === draft.categoryId);

  return (
    <div className="space-y-5">
      <Field label="Name" required error={errors.name}>
        {(id, describedBy) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            value={draft.name}
            invalid={!!errors.name}
            maxLength={NAME_MAX}
            placeholder="Alphonso Mango"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required error={errors.categoryId}>
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={!!errors.categoryId || undefined}
              className={cn(errors.categoryId && 'ring-rose-400 focus:ring-rose-500')}
              value={draft.categoryId}
              onChange={(event) => onChange({ categoryId: event.target.value })}
            >
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {draft.categoryId && !category ? (
                <option value={draft.categoryId}>Missing category ({draft.categoryId})</option>
              ) : null}
            </Select>
          )}
        </Field>
        <Field
          label="Pack size"
          required
          error={errors.unit}
          hint="Shown under the name: 1 kg, 6 pcs, 500 ml…"
        >
          {(id, describedBy) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={draft.unit}
              invalid={!!errors.unit}
              maxLength={UNIT_MAX}
              placeholder="1 kg"
              onChange={(event) => onChange({ unit: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price (₹)" required error={errors.price}>
          {(id, describedBy) => (
            <TextInput
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              max={PRICE_MAX}
              step="0.01"
              aria-describedby={describedBy}
              value={draft.price}
              invalid={!!errors.price}
              onChange={(event) => onChange({ price: event.target.value })}
            />
          )}
        </Field>
        <Field label="MRP (₹)" error={errors.mrp} hint="Optional. Shown struck through.">
          {(id, describedBy) => (
            <TextInput
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              max={PRICE_MAX}
              step="0.01"
              aria-describedby={describedBy}
              value={draft.mrp}
              invalid={!!errors.mrp}
              onChange={(event) => onChange({ mrp: event.target.value })}
            />
          )}
        </Field>
        <Field label="Stock" required error={errors.stock} hint="Units on the shelf.">
          {(id, describedBy) => (
            <TextInput
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={STOCK_MAX}
              step={1}
              aria-describedby={describedBy}
              value={draft.stock}
              invalid={!!errors.stock}
              onChange={(event) => onChange({ stock: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-700">Badge</p>
        <Segmented
          ariaLabel="Badge"
          value={draft.badge}
          options={BADGE_OPTIONS}
          onChange={(badge) => onChange({ badge })}
        />
      </div>

      <Field
        label="Description"
        error={errors.description}
        hint={`${draft.description.length.toLocaleString()} / ${DESCRIPTION_MAX.toLocaleString()} characters`}
      >
        {(id, describedBy) => (
          <TextArea
            id={id}
            rows={4}
            maxLength={DESCRIPTION_MAX}
            aria-describedby={describedBy}
            aria-invalid={!!errors.description || undefined}
            value={draft.description}
            placeholder="What makes it good, how to store it, how to use it."
            onChange={(event) => onChange({ description: event.target.value })}
          />
        )}
      </Field>

      <ArtPicker
        label="Illustration"
        keys={PRODUCT_ART_KEYS}
        value={draft.imageKey}
        tint={category?.tint}
        noneLabel="None"
        hint="Used whenever there is no photo."
        onChange={(imageKey) => onChange({ imageKey })}
      />

      <Field
        label="Photo URL"
        error={errors.imageUrl}
        hint="Optional https:// link to a product photo. Shown instead of the illustration."
      >
        {(id, describedBy) => (
          <TextInput
            id={id}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={IMAGE_URL_MAX}
            aria-describedby={describedBy}
            value={draft.imageUrl}
            invalid={!!errors.imageUrl}
            placeholder="https://"
            onChange={(event) => onChange({ imageUrl: event.target.value })}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Toggle
          checked={draft.active}
          onChange={(active) => onChange({ active })}
          label="Active"
          description="Visible and orderable in the shop."
        />
        <Toggle
          checked={draft.featured}
          onChange={(featured) => onChange({ featured })}
          label="Featured"
          description="Highlighted on the shop's home screen."
        />
      </div>
    </div>
  );
}
