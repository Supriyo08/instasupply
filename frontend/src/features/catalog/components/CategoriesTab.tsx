import type { Category } from '@instasupply/shared';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { QueryView } from '@/components/ui/Data';
import { ChevronDownIcon, EditIcon, GridIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { describeError } from '@/lib/api';
import { cn } from '@/lib/cn';

import { useCategories } from '../hooks';
import { saveCategoryOrder } from '../mutations';
import { useDialogState } from '../ui-hooks';
import { ArtThumb } from './ArtThumb';
import { CategoryFormModal } from './CategoryFormModal';

type Direction = 'up' | 'down';

function MoveButton({
  direction,
  name,
  inactive,
  onMove,
  buttonRef,
}: {
  direction: Direction;
  name: string;
  inactive: boolean;
  onMove: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const label = `Move ${name} ${direction}`;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      // aria-disabled keeps focus on the button while a move is saving or at the end of the list.
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

/**
 * Categories in shop order (staff, MARKETPLACE §9): reorder, and edit defaults and synonyms. A move
 * sends the whole order (review: correctness #1), keeps keyboard focus on the moved row's button and
 * announces the new position in a polite live region (review: ux #8).
 */
export function CategoriesTab() {
  const categories = useCategories();
  const toast = useToast();
  const dialog = useDialogState<Category>();
  const [moving, setMoving] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<{ id: string; direction: Direction } | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const list = [...categories.data].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const orderKey = list.map((category) => category.id).join(',');

  // Once the new order is on screen, put focus back on the moved row (the other arrow at an end).
  useEffect(() => {
    if (!focusTarget) return;
    const ids = orderKey.split(',');
    const index = ids.indexOf(focusTarget.id);
    if (index < 0) return;
    const atEnd = focusTarget.direction === 'up' ? index === 0 : index === ids.length - 1;
    const direction: Direction = atEnd
      ? focusTarget.direction === 'up'
        ? 'down'
        : 'up'
      : focusTarget.direction;
    const frame = window.requestAnimationFrame(() =>
      buttons.current.get(`${focusTarget.id}:${direction}`)?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget, orderKey]);

  const move = async (category: Category, direction: Direction) => {
    const ids = list.map((item) => item.id);
    const index = ids.indexOf(category.id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    next[index] = ids[target] ?? category.id;
    next[target] = category.id;
    setMoving(category.id);
    try {
      await saveCategoryOrder(next);
      setFocusTarget({ id: category.id, direction });
      setAnnouncement(`${category.name} moved to position ${target + 1} of ${ids.length}.`);
    } catch (caught) {
      toast.error(`Couldn't move ${category.name}`, describeError(caught));
    } finally {
      setMoving(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <QueryView
        query={categories}
        loadingLabel="Loading categories"
        empty={{
          icon: GridIcon,
          title: 'No categories',
          description: 'Categories come from the marketplace setup.',
        }}
      >
        {() => (
          <ol className="divide-y divide-slate-100">
            {list.map((category, index) => (
              <li key={category.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
                  <div className="flex shrink-0">
                    {(['up', 'down'] as const).map((direction) => (
                      <MoveButton
                        key={direction}
                        direction={direction}
                        name={category.name}
                        inactive={
                          moving !== null || (direction === 'up' ? index === 0 : index === list.length - 1)
                        }
                        onMove={() => void move(category, direction)}
                        buttonRef={(element) => {
                          const key = `${category.id}:${direction}`;
                          if (element) buttons.current.set(key, element);
                          else buttons.current.delete(key);
                        }}
                      />
                    ))}
                  </div>
                  <span className="w-6 text-right text-xs text-slate-400 tabular-nums">{index + 1}</span>
                  <ArtThumb artKey={category.iconKey} tint={category.tint} shape="circle" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {category.name}
                      {!category.active ? (
                        <Badge tone="neutral" className="ml-2">
                          Hidden
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {category.defaultWeightKg} kg · {category.defaultDimsCm.l}×{category.defaultDimsCm.w}×
                      {category.defaultDimsCm.h} cm · {category.synonyms.length} search words
                    </p>
                  </div>
                </div>
                <p className="hidden max-w-sm truncate text-xs text-slate-500 lg:block">
                  {category.synonyms.slice(0, 8).join(', ') || 'No search words yet'}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={EditIcon}
                  aria-label={`Edit ${category.name}`}
                  className="ml-auto"
                  onClick={() => dialog.show(category)}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ol>
        )}
      </QueryView>
      {dialog.data ? (
        <CategoryFormModal
          key={dialog.session}
          open={dialog.open}
          onClose={dialog.close}
          category={dialog.data}
        />
      ) : null}
    </Card>
  );
}
