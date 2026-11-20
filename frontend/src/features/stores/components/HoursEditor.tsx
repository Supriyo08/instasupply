import { WEEKDAYS, WEEKDAY_NAMES, type DayHours, type Weekday } from '@instasupply/shared';
import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { TextInput, Toggle } from '@/components/ui/Form';
import { CloseIcon, PlusIcon } from '@/components/ui/icons';

export type WeekHours = Record<Weekday, DayHours | null>;

/** Opening hours in Toronto time, one interval per weekday or closed (MARKETPLACE §4.2). */
export function HoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: WeekHours;
  onChange: (next: WeekHours) => void;
  disabled?: boolean;
}) {
  const set = (day: Weekday, hours: DayHours | null) => onChange({ ...value, [day]: hours });
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-slate-700">Opening hours (Toronto time)</legend>
      {WEEKDAYS.map((day) => {
        const hours = value[day];
        return (
          <div key={day} className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-sm text-slate-700">{WEEKDAY_NAMES[day]}</span>
            <Toggle
              checked={hours !== null}
              onChange={(open) => set(day, open ? { open: '07:00', close: '17:00' } : null)}
              label={hours ? 'Open' : 'Closed'}
            />
            {hours ? (
              <span className="flex items-center gap-2">
                <TextInput
                  type="time"
                  aria-label={`${WEEKDAY_NAMES[day]} opens`}
                  value={hours.open}
                  onChange={(event) => set(day, { ...hours, open: event.target.value })}
                  className="w-32"
                />
                <span className="text-slate-400">to</span>
                <TextInput
                  type="time"
                  aria-label={`${WEEKDAY_NAMES[day]} closes`}
                  value={hours.close}
                  onChange={(event) => set(day, { ...hours, close: event.target.value })}
                  className="w-32"
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Extra closed dates (`YYYY-MM-DD`, at most 60), on top of the Ontario holidays. */
export function ClosuresEditor({
  value,
  onChange,
  minDate,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Today in Toronto: past dates are refused by the server for a profile edit. */
  minDate?: string;
  disabled?: boolean;
}) {
  const [date, setDate] = useState('');
  const add = () => {
    if (!date || value.includes(date) || value.length >= 60) return;
    onChange([...value, date].sort());
    setDate('');
  };
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-slate-700">Closure dates</legend>
      <p className="text-xs text-slate-500">Statutory holidays in Ontario are closed automatically.</p>
      <div className="flex items-center gap-2">
        <TextInput
          type="date"
          aria-label="Closure date to add"
          min={minDate}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="w-44"
        />
        <Button variant="secondary" size="sm" icon={PlusIcon} onClick={add} disabled={!date}>
          Add date
        </Button>
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Closure dates">
          {value.map((day) => (
            <li
              key={day}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-3 text-xs text-slate-700"
            >
              {day}
              <IconButton
                icon={CloseIcon}
                size="sm"
                label={`Remove ${day}`}
                onClick={() => onChange(value.filter((item) => item !== day))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
