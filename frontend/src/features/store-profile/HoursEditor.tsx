import { WEEKDAYS, WEEKDAY_NAMES, formatDayET, fromLocal, type Weekday } from '@instasupply/shared';
import { useId, useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { CloseIcon, CopyIcon, PlusIcon } from '@/components/ui/icons';

import type { DayDraft } from './profile-form';

/** At most this many extra closed dates (MARKETPLACE §1.3 `Store.closures`). */
export const MAX_CLOSURES = 60;

/**
 * Opening hours for the seven days, Monday first: "Closed" or one interval in Toronto time. One
 * interval per day, never overnight (MARKETPLACE §4.2). "Copy Monday to weekdays" saves typing.
 */
export function HoursEditor({
  value,
  onChange,
  error,
  disabled,
}: {
  value: Record<Weekday, DayDraft>;
  onChange: (value: Record<Weekday, DayDraft>) => void;
  error?: string;
  disabled?: boolean;
}) {
  const legendId = useId();
  const set = (day: Weekday, patch: Partial<DayDraft>) =>
    onChange({ ...value, [day]: { ...value[day], ...patch } });
  const copyMonday = () => {
    const monday = value.mon;
    const next = { ...value };
    for (const day of ['tue', 'wed', 'thu', 'fri'] as const) next[day] = { ...monday };
    onChange(next);
  };

  return (
    <fieldset aria-labelledby={legendId} className="space-y-2" disabled={disabled}>
      <div className="flex items-center justify-between gap-3">
        <legend id={legendId} className="text-sm font-medium text-slate-700">
          Opening hours
        </legend>
        <Button size="sm" variant="ghost" icon={CopyIcon} onClick={copyMonday}>
          Copy Monday to weekdays
        </Button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {WEEKDAYS.map((day) => {
          const hours = value[day];
          const name = WEEKDAY_NAMES[day];
          const invalid = !hours.closed && hours.close <= hours.open;
          return (
            <li key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
              <span className="w-24 text-sm font-medium text-slate-800">{name}</span>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-brand-600"
                  checked={hours.closed}
                  onChange={(event) => set(day, { closed: event.target.checked })}
                />
                Closed
              </label>
              {hours.closed ? null : (
                <div className="flex items-center gap-2">
                  <TextInput
                    type="time"
                    step={300}
                    aria-label={`${name} opens at`}
                    className="w-32"
                    value={hours.open}
                    onChange={(event) => set(day, { open: event.target.value })}
                  />
                  <span className="text-sm text-slate-500" aria-hidden>
                    to
                  </span>
                  <TextInput
                    type="time"
                    step={300}
                    aria-label={`${name} closes at`}
                    className="w-32"
                    value={hours.close}
                    invalid={invalid}
                    onChange={(event) => set(day, { close: event.target.value })}
                  />
                  {invalid ? (
                    <span className="text-xs font-medium text-rose-600">Closes before it opens</span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </fieldset>
  );
}

/**
 * Extra closed days ("Boxing Day", "stock-take"), `YYYY-MM-DD` from today on, at most 60. Ontario
 * statutory holidays are already closed for every store and need no entry.
 */
export function ClosuresEditor({
  value,
  onChange,
  today,
  now,
  error,
  disabled,
}: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  today: string;
  now: number;
  error?: string;
  disabled?: boolean;
}) {
  const [date, setDate] = useState('');
  const inputId = useId();
  const full = value.length >= MAX_CLOSURES;
  const add = () => {
    if (!date || date < today || value.includes(date) || full) return;
    onChange([...value, date].sort());
    setDate('');
  };
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        Closed dates
      </label>
      <div className="flex items-center gap-2">
        <TextInput
          id={inputId}
          type="date"
          min={today}
          className="w-44"
          value={date}
          disabled={disabled || full}
          onChange={(event) => setDate(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          variant="secondary"
          icon={PlusIcon}
          onClick={add}
          disabled={disabled || !date || date < today || value.includes(date) || full}
        >
          Add date
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Ontario statutory holidays are closed automatically. {value.length} of {MAX_CLOSURES} dates used.
      </p>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((day) => {
            const label = formatDayET(fromLocal(day, 12 * 60), now);
            return (
              <li
                key={day}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-3 text-sm text-slate-700"
              >
                {label}
                <IconButton
                  icon={CloseIcon}
                  size="sm"
                  label={`Remove ${label}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((item) => item !== day))}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}
