import { discountPercent } from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { HiddenIcon, StarIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import { stockLevel } from '../catalog-filters';
import type { CategoryRecord } from '../hooks';
import { isHttpsUrl, parseNumber, roundMoney, type ProductDraft } from '../product-form';
import { ArtThumb } from './ArtThumb';
import { PriceTag, ProductBadge } from './ProductParts';

/** Live preview of the shop's product card while the form is being edited. */
export function ProductPreview({
  draft,
  category,
}: {
  draft: ProductDraft;
  category: CategoryRecord | null;
}) {
  const parsedPrice = parseNumber(draft.price);
  const price = parsedPrice !== null && parsedPrice >= 0 ? roundMoney(parsedPrice) : null;
  const parsedMrp = parseNumber(draft.mrp);
  const mrp = parsedMrp !== null ? roundMoney(parsedMrp) : null;
  const discount = price !== null ? discountPercent({ price, mrp }) : null;
  const stock = parseNumber(draft.stock);
  const level = stock !== null ? stockLevel({ stock, active: draft.active }) : null;
  const imageUrl = isHttpsUrl(draft.imageUrl.trim()) ? draft.imageUrl.trim() : null;

  const footer = !draft.active
    ? { text: 'Hidden from shoppers', className: 'text-slate-500' }
    : level === 'out'
      ? { text: 'Sold out', className: 'text-rose-600' }
      : level === 'low'
        ? { text: `Only ${stock} left`, className: 'text-amber-700' }
        : { text: 'Add to cart', className: 'text-brand-700' };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Shop preview</p>
      <div
        className={cn(
          'overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card',
          !draft.active && 'opacity-75',
        )}
      >
        <div className="px-3 pt-3">
          <div className="flex min-h-6 items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              <ProductBadge badge={draft.badge === 'none' ? null : draft.badge} />
              {discount ? <Badge tone="danger">-{discount}%</Badge> : null}
            </div>
            {draft.featured ? (
              <span title="Featured" className="text-amber-500">
                <StarIcon size={16} className="fill-amber-400" aria-hidden />
                <span className="sr-only">Featured</span>
              </span>
            ) : null}
          </div>
          <div className="my-2 flex justify-center">
            <ArtThumb
              artKey={draft.imageKey}
              imageUrl={imageUrl}
              tint={category?.tint}
              size="xl"
              shape="circle"
            />
          </div>
          <div className="pb-3 text-center">
            <PriceTag price={price} mrp={mrp} showSaving={false} className="justify-center" />
            <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
              {draft.name.trim() || 'Product name'}
            </p>
            <p className="truncate text-xs text-slate-500">{draft.unit.trim() || 'Pack size'}</p>
          </div>
        </div>
        <div
          className={cn(
            'flex items-center justify-center gap-1.5 border-t border-slate-100 py-2 text-xs font-medium',
            footer.className,
          )}
        >
          {!draft.active ? <HiddenIcon size={14} aria-hidden /> : null}
          {footer.text}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {category ? `Listed under ${category.name}.` : 'Choose a category to see its colours.'}
      </p>
    </div>
  );
}
