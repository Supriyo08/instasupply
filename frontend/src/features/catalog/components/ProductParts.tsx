import { discountPercent, formatCurrency, type Product } from '@instasupply/shared';

import { Badge, type Tone } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { DeleteIcon, EditIcon, StarIcon, WarningIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import type { CategoryRecord, ProductRecord } from '../hooks';
import { BADGE_LABELS, type ProductBadge as BadgeValue } from '../product-form';

const BADGE_TONES: Record<BadgeValue, Tone> = { new: 'info', bestseller: 'warning', organic: 'success' };

export function ProductBadge({ badge }: { badge: Product['badge'] | undefined }) {
  if (!badge) return null;
  return <Badge tone={BADGE_TONES[badge]}>{BADGE_LABELS[badge]}</Badge>;
}

/** Price, with the MRP struck through and the saving when discounted. */
export function PriceTag({
  price,
  mrp,
  showSaving = true,
  className,
}: {
  price: number | null;
  mrp: number | null;
  /** Append "-x%" after the struck-through MRP. */
  showSaving?: boolean;
  className?: string;
}) {
  const discount = price != null ? discountPercent({ price, mrp }) : null;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 whitespace-nowrap', className)}>
      <span className="font-medium text-slate-900 tabular-nums">{formatCurrency(price)}</span>
      {discount ? (
        <>
          <s className="text-xs text-slate-400 tabular-nums">
            <span className="sr-only">MRP </span>
            {formatCurrency(mrp)}
          </s>
          {showSaving ? <span className="text-xs font-semibold text-emerald-600">-{discount}%</span> : null}
        </>
      ) : null}
    </span>
  );
}

/** "★ 4.5 · 12" */
export function RatingTag({ rating, count }: { rating: number; count: number }) {
  if (!count) return <span className="text-xs whitespace-nowrap text-slate-400">No ratings</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-slate-600">
      <StarIcon size={12} className="fill-amber-400 text-amber-400" aria-hidden />
      <span className="font-medium text-slate-800 tabular-nums">{rating.toFixed(1)}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{count}</span>
      <span className="sr-only">{count === 1 ? 'rating' : 'ratings'}</span>
    </span>
  );
}

/** Category name, or a warning when the product points at a category that no longer exists. */
export function CategoryName({
  category,
  categoryId,
}: {
  category: CategoryRecord | undefined;
  categoryId: string;
}) {
  if (category) return <>{category.name}</>;
  return (
    <span
      className="inline-flex items-center gap-1 text-amber-700"
      title={`Category "${categoryId}" not found`}
    >
      <WarningIcon size={12} aria-hidden />
      No category
    </span>
  );
}

export function ProductActions({
  product,
  canDelete,
  compact = false,
  onEdit,
  onDelete,
}: {
  product: ProductRecord;
  canDelete: boolean;
  /** Icon-only edit button, for narrow cards. */
  compact?: boolean;
  onEdit: (product: ProductRecord) => void;
  onDelete: (product: ProductRecord) => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {compact ? (
        <IconButton
          icon={EditIcon}
          size="sm"
          label={`Edit ${product.name}`}
          onClick={() => onEdit(product)}
        />
      ) : (
        <Button
          size="sm"
          variant="secondary"
          icon={EditIcon}
          aria-label={`Edit ${product.name}`}
          title={`Edit ${product.name}`}
          onClick={() => onEdit(product)}
        >
          <span className="hidden xl:inline">Edit</span>
        </Button>
      )}
      {canDelete ? (
        <IconButton
          icon={DeleteIcon}
          size="sm"
          label={`Delete ${product.name}`}
          onClick={() => onDelete(product)}
        />
      ) : null}
    </div>
  );
}
