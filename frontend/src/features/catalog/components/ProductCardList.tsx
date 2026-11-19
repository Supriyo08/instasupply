import { cn } from '@/lib/cn';

import { ArtThumb } from './ArtThumb';
import { FlagSwitch } from './FlagSwitch';
import { CategoryName, PriceTag, ProductActions, ProductBadge, RatingTag } from './ProductParts';
import type { ProductRowsProps } from './ProductTable';
import { StockEditor } from './StockEditor';

/** Phone layout: one stacked card per product with the same inline controls as the table. */
export function ProductCardList({ products, categoryById, canDelete, onEdit, onDelete }: ProductRowsProps) {
  return (
    <ul className="divide-y divide-slate-100">
      {products.map((product) => {
        const category = categoryById.get(product.categoryId);
        return (
          <li key={product.id} className="space-y-3 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <ArtThumb
                artKey={product.imageKey}
                imageUrl={product.imageUrl}
                tint={category?.tint}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-sm font-medium',
                    product.active ? 'text-slate-900' : 'text-slate-500',
                  )}
                >
                  {product.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {product.unit} · <CategoryName category={category} categoryId={product.categoryId} />
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <PriceTag price={product.price} mrp={product.mrp} />
                  <RatingTag rating={product.rating} count={product.ratingCount} />
                  <ProductBadge badge={product.badge} />
                </div>
              </div>
              <ProductActions
                product={product}
                canDelete={canDelete}
                compact
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </div>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <StockEditor product={product} />
              <div className="flex items-center gap-4 pt-1.5">
                <FlagSwitch product={product} flag="active" showLabel />
                <FlagSwitch product={product} flag="featured" showLabel />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
