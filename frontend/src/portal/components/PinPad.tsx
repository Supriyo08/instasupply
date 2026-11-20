import { useEffect, useRef } from 'react';

import { CloseIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export const PIN_LENGTH = 4;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Four-digit PIN entry for the counter: big keys for a touch screen, and the keyboard works too
 * (digits, Backspace, Enter). The PIN is shown as dots; `onSubmit` fires on Enter with 4 digits.
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    onChange(value + digit);
  };
  const back = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          press(event.key);
        } else if (event.key === 'Backspace') {
          event.preventDefault();
          back();
        } else if (event.key === 'Enter' && value.length === PIN_LENGTH && !disabled) {
          event.preventDefault();
          onSubmit();
        }
      }}
      className="mx-auto w-full max-w-xs rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="flex justify-center gap-3 py-2" aria-live="polite">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={cn(
              'grid size-12 place-items-center rounded-xl text-2xl font-bold ring-1',
              index < value.length
                ? 'bg-slate-900 text-white ring-slate-900'
                : 'bg-white text-slate-300 ring-slate-300',
            )}
            aria-hidden
          >
            {index < value.length ? '•' : ''}
          </span>
        ))}
        <span className="sr-only">
          {value.length} of {PIN_LENGTH} digits entered
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {KEYS.map((digit) => (
          <PadKey key={digit} label={digit} onPress={() => press(digit)} disabled={disabled} />
        ))}
        <span aria-hidden />
        <PadKey label="0" onPress={() => press('0')} disabled={disabled} />
        <button
          type="button"
          onClick={back}
          disabled={disabled || value.length === 0}
          aria-label="Delete last digit"
          className="grid h-14 place-items-center rounded-xl bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-40"
        >
          <CloseIcon size={20} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PadKey({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="h-14 rounded-xl bg-white text-xl font-semibold text-slate-900 shadow-sm ring-1 ring-slate-300 transition-colors ring-inset hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
