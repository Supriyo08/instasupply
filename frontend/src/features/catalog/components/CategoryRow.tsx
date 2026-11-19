import { pluralize } from '@instasupply/shared';
import { useId } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { ChevronDownIcon, DeleteIcon, EditIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import type { CategoryRecord } from '../hooks';
import { ArtThumb } from './ArtThumb';

/** Same look as IconButton; aria-disabled keeps focus on the button while a move is saving. */
function MoveButton({
  direction,
  label,
  inactive,
  onMove,
}: {
  direction: 'up' | 'down';
  label: string;
  inactive: boolean;
  onMove: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={inactive || undefined}
      onClick={() => {
        if (!inactive) onMove();
      }}
      className="inline-grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
    >
      <ChevronDownIcon size={16} className={cn(direction === 'up' && 'rotate-180')} aria-hidden />
    </button>
  );
}

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${label} ${color}`}>
      <span
        className="size-4 shrink-0 rounded-md ring-1 ring-slate-900/10 ring-inset"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
      <span className="font-mono text-[11px] text-slate-500">{color}</span>
    </span>
  );
}

export function CategoryRow({
  category,
  counts,
  isFirst,
  isLast,
  moving,
  canDelete,
  onMove,
  onEdit,
  onDelete,
  onViewProducts,
}: {
  category: CategoryRecord;
  counts: { active: number; total: number };
  isFirst: boolean;
  isLast: boolean;
  moving: boolean;
  canDelete: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewProducts: () => void;
}) {
  const reasonId = useId();
  const inUse = counts.total > 0;

  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
        <div className="flex shrink-0">
          <MoveButton
            direction="up"
            label={`Move ${category.name} up`}
            inactive={moving || isFirst}
            onMove={() => onMove(-1)}
          />
          <MoveButton
            direction="down"
            label={`Move ${category.name} down`}
            inactive={moving || isLast}
            onMove={() => onMove(1)}
          />
        </div>
        <ArtThumb artKey={category.iconKey} tint={category.tint} shape="circle" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{category.name}</p>
          <p className="truncate text-xs text-slate-500">
            <span className="font-mono">{category.id}</span> · order {category.sortOrder}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Swatch label="Tint" color={category.tint} />
        <Swatch label="Accent" color={category.accent} />
      </div>

      <button
        type="button"
        onClick={onViewProducts}
        className="w-36 rounded text-left text-xs whitespace-nowrap text-slate-600 decoration-slate-300 underline-offset-2 hover:text-brand-700 hover:underline"
      >
        <span className="font-semibold text-slate-900 tabular-nums">{counts.active}</span> active ·{' '}
        <span className="tabular-nums">{counts.total}</span> total
        <span className="sr-only"> products. Show {category.name} products</span>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          icon={EditIcon}
          aria-label={`Edit ${category.name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        {canDelete ? (
          <>
            <IconButton
              icon={DeleteIcon}
              size="sm"
              label={`Delete ${category.name}`}
              title={
                inUse
                  ? `Move or delete its ${pluralize(counts.total, 'product')} first`
                  : `Delete ${category.name}`
              }
              aria-disabled={inUse || undefined}
              aria-describedby={inUse ? reasonId : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              onClick={() => {
                if (!inUse) onDelete();
              }}
            />
            {inUse ? (
              <span id={reasonId} className="sr-only">
                Only empty categories can be deleted. Move or delete its products first.
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}
