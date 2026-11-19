import { pluralize } from '@instasupply/shared';

import { TONE_CLASSES, type Tone } from '@/components/ui/Badge';
import { Select, TextInput } from '@/components/ui/Form';
import { SearchIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import {
  SORT_OPTIONS,
  STATUS_OPTIONS,
  type CatalogSummary,
  type SortKey,
  type StatusFilter,
} from '../catalog-filters';
import type { CategoryRecord } from '../hooks';
import type { ProductFilters } from '../url-state';

/** Search, category, status and sort controls. */
export function ProductFilterBar({
  filters,
  categories,
  onChange,
}: {
  filters: ProductFilters;
  categories: CategoryRecord[];
  onChange: (patch: Partial<ProductFilters>) => void;
}) {
  const unknownCategory =
    filters.category && !categories.some((category) => category.id === filters.category)
      ? filters.category
      : null;

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 md:flex-row md:items-center">
      <div className="relative flex-1">
        <SearchIcon
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <TextInput
          type="search"
          enterKeyHint="search"
          aria-label="Search products by name"
          className="pl-9"
          placeholder="Search products"
          value={filters.q}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:flex md:items-center">
        <Select
          aria-label="Filter by category"
          className="md:w-44"
          value={filters.category}
          onChange={(event) => onChange({ category: event.target.value })}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
          {unknownCategory ? <option value={unknownCategory}>Unknown category</option> : null}
        </Select>
        <Select
          aria-label="Filter by status"
          className="md:w-36"
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Sort products"
          className="col-span-2 md:w-44"
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as SortKey })}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

const CHIPS: { status: StatusFilter; tone: Tone; label: (summary: CatalogSummary) => string }[] = [
  { status: 'all', tone: 'brand', label: (summary) => pluralize(summary.total, 'product') },
  { status: 'hidden', tone: 'neutral', label: (summary) => `${summary.hidden} hidden` },
  { status: 'low', tone: 'warning', label: (summary) => `${summary.low} low stock` },
  { status: 'out', tone: 'danger', label: (summary) => `${summary.out} out of stock` },
];

/** Counts for the current search and category; each chip doubles as a quick status filter. */
export function SummaryChips({
  summary,
  status,
  onSelect,
}: {
  summary: CatalogSummary;
  status: StatusFilter;
  onSelect: (status: StatusFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Catalog summary"
      className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 sm:px-5"
    >
      {CHIPS.map((chip) => {
        const pressed = status === chip.status;
        return (
          <button
            key={chip.status}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(pressed ? 'all' : chip.status)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset transition-colors',
              pressed
                ? TONE_CLASSES[chip.tone].badge
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            <span className={cn('size-1.5 rounded-full', TONE_CLASSES[chip.tone].dot)} aria-hidden />
            <span className="tabular-nums">{chip.label(summary)}</span>
          </button>
        );
      })}
    </div>
  );
}
