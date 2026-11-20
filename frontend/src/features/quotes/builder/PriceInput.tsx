/**
 * The quote builder's "Agreed price $" field. The typed text stays exactly as typed while the field is
 * being edited (re-rendering it from cents on every key moved the caret and turned "1" + "2" into
 * "1.002" → $1.00). Every valid parse goes to the draft at once so the live totals follow; the text is
 * tidied to "12.50" on blur or Enter. Invalid text stays visible with its error and is reported through
 * `onValidity` so the page can hold Send.
 */
import { useState } from 'react';

import { TextInput } from '@/components/ui/Form';

import { parsePriceText, priceText } from './price-text';

export function PriceInput({
  cents,
  onChange,
  onValidity,
  placeholder,
  label,
  className,
}: {
  /** The agreed price in cents, or null for the list price. */
  cents: number | null;
  onChange: (cents: number | null) => void;
  onValidity?: (valid: boolean) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  // null: not being edited, so the field shows `cents`.
  const [text, setText] = useState<string | null>(null);
  const parsed = text === null ? null : parsePriceText(text);
  const error = parsed && !parsed.ok ? parsed.error : null;

  const finish = () => {
    if (parsed?.ok) setText(null);
  };

  return (
    <>
      <TextInput
        inputMode="decimal"
        placeholder={placeholder}
        value={text ?? priceText(cents)}
        aria-label={label}
        invalid={error !== null}
        title={error ?? undefined}
        className={className}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const result = parsePriceText(next);
          onValidity?.(result.ok);
          if (result.ok && result.cents !== cents) onChange(result.cents);
        }}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish();
          }
        }}
      />
      {error ? (
        <span role="alert" className="text-xs font-medium text-rose-700">
          {error}
        </span>
      ) : null}
    </>
  );
}
