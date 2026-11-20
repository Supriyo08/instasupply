import type { QueryKey } from '@instasupply/api-client';
import { CATEGORIES, availableQty, type Product } from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { DeleteIcon, EditIcon, SparklesIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import { isLowStock } from '../catalog-model';
import { ArtThumb } from './ArtThumb';
import { ActiveSwitch, PriceCell, StockCell } from './InlineCells';

/**
 * The catalogue table (MARKETPLACE §8): SKU, name, brand, category, unit/size, price, on hand,
 * reserved, available, active, with inline price and on-hand edits and the active switch. Staff see
 * the store and the staff-only flags. Rows come in the frozen order of `useFrozenRows`.
 */
export function ProductTable({
  products,
  listKey,
  showStore,
  staff,
  canDelete,
  onEdit,
  onDelete,
}: {
  products: readonly Product[];
  listKey: QueryKey | null;
  showStore: boolean;
  staff: boolean;
  canDelete: boolean;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-left text-sm">
        <caption className="sr-only">Products, with inline price and stock editing</caption>
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Product
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              SKU
            </th>
            {showStore ? (
              <th scope="col" className="px-3 py-2.5 font-medium">
                Store
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2.5 font-medium">
              Category
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Unit / size
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Price
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              On hand
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Reserved
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Available
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              For sale
            </th>
            <th scope="col" className="px-3 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {products.map((product) => {
            const category = CATEGORIES[product.categoryId];
            const available = availableQty(product);
            const low = isLowStock(product);
            const deletable = canDelete && product.reserved === 0;
            return (
              <tr key={product.id} className={cn(!product.active && 'bg-slate-50/70')}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <ArtThumb
                      artKey={product.imageKey ?? category?.iconKey ?? null}
                      imageUrl={product.imageUrl}
                      tint={category?.tint}
                    />
                    <div className="min-w-0">
                      <p className={cn('font-medium', product.active ? 'text-slate-900' : 'text-slate-500')}>
                        {product.name}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        {product.brand ?? 'No brand'}
                        {product.shipEstimated ? <Badge tone="warning">Estimated size</Badge> : null}
                        {staff && product.featured ? (
                          <Badge tone="brand">
                            <SparklesIcon size={11} aria-hidden /> Featured
                          </Badge>
                        ) : null}
                        {staff && product.badge ? <Badge tone="info">{product.badge}</Badge> : null}
                        {staff && product.familyKey ? (
                          <span className="font-mono text-[11px]">{product.familyKey}</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-slate-600">
                  {product.sku}
                </td>
                {showStore ? <td className="px-3 py-2.5 text-slate-700">{product.storeName}</td> : null}
                <td className="px-3 py-2.5 text-slate-700">{category?.name ?? product.categoryId}</td>
                <td className="px-3 py-2.5 text-slate-700">
                  <span className="capitalize">{product.unit}</span>
                  {product.size ? <span className="block text-xs text-slate-500">{product.size}</span> : null}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <PriceCell product={product} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <StockCell product={product} listKey={listKey} />
                </td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                  {product.reserved.toLocaleString('en-CA')}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      available === 0 ? 'text-rose-600' : low ? 'text-amber-700' : 'text-slate-900',
                    )}
                  >
                    {available.toLocaleString('en-CA')}
                  </span>
                  {available === 0 ? (
                    <span className="block text-xs text-rose-600">Sold out</span>
                  ) : low ? (
                    <span className="block text-xs text-amber-700">Low</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <ActiveSwitch product={product} listKey={listKey} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <IconButton
                      icon={EditIcon}
                      size="sm"
                      label={`Edit ${product.name}`}
                      onClick={() => onEdit(product)}
                    />
                    {canDelete ? (
                      <IconButton
                        icon={DeleteIcon}
                        size="sm"
                        label={
                          deletable
                            ? `Delete ${product.name}`
                            : `${product.name} can't be deleted while ${product.reserved} are held by open orders`
                        }
                        aria-disabled={!deletable || undefined}
                        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                        onClick={() => {
                          if (deletable) onDelete(product);
                        }}
                      />
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
