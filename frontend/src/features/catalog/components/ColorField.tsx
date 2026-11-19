import { Field, TextInput } from '@/components/ui/Form';

import { normalizeHex } from '../category-form';

/** Hex colour as text, with the native colour picker alongside. */
export function ColorField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder: string;
}) {
  const hex = normalizeHex(value);
  return (
    <Field label={label} required error={error} hint={hint}>
      {(id, describedBy) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={(hex ?? placeholder).toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="h-9 w-11 shrink-0 cursor-pointer rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-300 ring-inset [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
          <TextInput
            id={id}
            aria-describedby={describedBy}
            value={value}
            invalid={!!error}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            placeholder={placeholder}
            className="font-mono uppercase"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )}
    </Field>
  );
}
