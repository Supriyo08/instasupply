import { cn } from '@/lib/cn';

import type { CategoryRecord, ProductRecord } from '../hooks';
import { ArtThumb } from './ArtThumb';
import { FlagSwitch } from './FlagSwitch';
import { CategoryName, PriceTag, ProductActions, ProductBadge, RatingTag } from './ProductParts';
import { StockEditor } from './StockEditor';

export interface ProductRowsProps {
  products: ProductRecord[];
  categoryById: Map<string, CategoryRecord>;
  canDelete: boolean;
  onEdit: (product: ProductRecord) => void;
  onDelete: (product: ProductRecord) => void;
}

/** Dense product table for tablet and desktop widths. */
export function ProductTable({ products, categoryById, canDelete, onEdit, onDelete }: ProductRowsProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Product
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium xl:table-cell">
              Category
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Price
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Stock
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium xl:table-cell">
              Rating
            </th>
            <th scope="col" className="px-3 py-3 text-center font-medium">
              Active
            </th>
            <th scope="col" className="px-3 py-3 text-center font-medium">
              Featured
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {products.map((product) => {
            const category = categoryById.get(product.categoryId);
            return (
              <tr key={product.id} className="transition-colors hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <ArtThumb artKey={product.imageKey} imageUrl={product.imageUrl} tint={category?.tint} />
                    <div className="max-w-40 min-w-0 xl:max-w-60">
                      <p
                        title={product.name}
                        className={cn(
                          'truncate font-medium',
                          product.active ? 'text-slate-900' : 'text-slate-500',
                        )}
                      >
                        {product.name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                        <span className="whitespace-nowrap">{product.unit}</span>
                        <span className="whitespace-nowrap xl:hidden">
                          · <CategoryName category={category} categoryId={product.categoryId} />
                        </span>
                        <ProductBadge badge={product.badge} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-3 whitespace-nowrap text-slate-700 xl:table-cell">
                  <CategoryName category={category} categoryId={product.categoryId} />
                </td>
                <td className="px-3 py-3 text-right">
                  <PriceTag price={product.price} mrp={product.mrp} className="justify-end" />
                </td>
                <td className="px-3 py-3">
                  <StockEditor product={product} />
                </td>
                <td className="hidden px-3 py-3 xl:table-cell">
                  <RatingTag rating={product.rating} count={product.ratingCount} />
                </td>
                <td className="px-3 py-3 text-center">
                  <FlagSwitch product={product} flag="active" />
                </td>
                <td className="px-3 py-3 text-center">
                  <FlagSwitch product={product} flag="featured" />
                </td>
                <td className="px-5 py-3">
                  <ProductActions
                    product={product}
                    canDelete={canDelete}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
