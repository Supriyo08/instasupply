import { useId, useMemo, useState } from 'react';

import { TextInput } from '@/components/ui/Form';
import { NoImageIcon, SearchIcon } from '@/components/ui/icons';

import { artLabel, artSrc } from '../art';
import { normalizeHex } from '../category-form';

/** Show the search box once there are more options than fit in two rows. */
const SEARCH_FROM = 12;

/**
 * Searchable grid of illustrations as a native radio group (arrow keys move the selection). A
 * current key that is no longer in the art set stays selectable, so editing never drops it.
 */
export function ArtPicker({
  label,
  keys,
  value,
  onChange,
  tint,
  noneLabel,
  error,
  hint,
}: {
  label: string;
  keys: readonly string[];
  value: string | null;
  onChange: (key: string | null) => void;
  tint?: string | null;
  /** Adds a first "no illustration" option with this label. */
  noneLabel?: string;
  error?: string;
  hint?: string;
}) {
  const name = useId();
  const messageId = useId();
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => (term ? keys.filter((key) => artLabel(key).toLowerCase().includes(term)) : keys),
    [keys, term],
  );
  const missing = value && !keys.includes(value) ? value : null;
  const background = normalizeHex(tint);

  const option = (key: string | null, text: string) => {
    const src = artSrc(key);
    return (
      <label
        key={key ?? '__none'}
        title={text}
        className="flex cursor-pointer flex-col items-center gap-1 rounded-xl p-1.5 text-center ring-1 ring-slate-200 transition-colors ring-inset hover:bg-slate-50 has-checked:bg-brand-50 has-checked:ring-2 has-checked:ring-brand-500 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-500"
      >
        <input
          type="radio"
          name={name}
          value={key ?? ''}
          checked={value === key}
          onChange={() => onChange(key)}
          className="sr-only"
        />
        <span
          className="grid aspect-square w-full place-items-center rounded-lg bg-slate-100"
          style={background && key ? { backgroundColor: background } : undefined}
        >
          {src ? (
            <img src={src} alt="" loading="lazy" className="h-4/5 w-4/5 object-contain" />
          ) : (
            <NoImageIcon size={18} className="text-slate-400" aria-hidden />
          )}
        </span>
        <span className="w-full truncate text-[11px] leading-tight text-slate-600">{text}</span>
      </label>
    );
  };

  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={error || hint ? messageId : undefined}>
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      {keys.length > SEARCH_FROM ? (
        <div className="relative">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <TextInput
            type="search"
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${keys.length} illustrations`}
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // Enter filters; it must not submit the surrounding form.
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </div>
      ) : null}
      <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto p-1 sm:grid-cols-6">
        {noneLabel !== undefined ? option(null, noneLabel) : null}
        {missing ? option(missing, `${artLabel(missing)} (unavailable)`) : null}
        {visible.map((key) => option(key, artLabel(key)))}
      </div>
      {keys.length === 0 ? (
        <p className="text-xs text-slate-500">No illustrations are available right now.</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-slate-500">No illustrations match “{search.trim()}”.</p>
      ) : null}
      {error ? (
        <p id={messageId} className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
