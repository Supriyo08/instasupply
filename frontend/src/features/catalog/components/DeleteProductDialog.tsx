import { formatCurrency, pluralize } from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DeleteIcon, HiddenIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/firebase/callables';

import type { CategoryRecord, ProductRecord } from '../hooks';
import { deleteProduct, setProductFlag } from '../mutations';
import { ArtThumb } from './ArtThumb';

/** Admin-only, irreversible delete, with "hide instead" for products that are still live. */
export function DeleteProductDialog({
  product,
  category,
  open,
  onClose,
}: {
  product: ProductRecord | null;
  category: CategoryRecord | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'delete' | 'hide' | null>(null);

  const run = async (action: 'delete' | 'hide') => {
    if (!product) return;
    setBusy(action);
    try {
      if (action === 'delete') {
        await deleteProduct(product.id);
        toast.success(`${product.name} deleted`);
      } else {
        await setProductFlag(product.id, 'active', false);
        toast.success(`${product.name} is hidden from the shop`);
      }
      onClose();
    } catch (error) {
      toast.error(
        action === 'delete' ? `Couldn't delete ${product.name}` : `Couldn't hide ${product.name}`,
        errorMessage(error),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open && !!product}
      onClose={onClose}
      size="sm"
      title={product ? `Delete ${product.name}?` : 'Delete product'}
      description="This can't be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {product?.active ? (
            <Button
              variant="secondary"
              icon={HiddenIcon}
              loading={busy === 'hide'}
              disabled={busy !== null}
              onClick={() => void run('hide')}
            >
              Hide instead
            </Button>
          ) : null}
          <Button
            variant="danger"
            icon={DeleteIcon}
            loading={busy === 'delete'}
            disabled={busy !== null}
            onClick={() => void run('delete')}
          >
            Delete product
          </Button>
        </>
      }
    >
      {product ? (
        <div className="space-y-4 text-sm text-slate-600">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <ArtThumb artKey={product.imageKey} imageUrl={product.imageUrl} tint={category?.tint} />
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{product.name}</p>
              <p className="text-xs text-slate-500">
                {product.unit} · {formatCurrency(product.price)} · {pluralize(product.stock, 'unit')} in stock
              </p>
            </div>
          </div>
          <ul className="list-disc space-y-1 pl-5">
            <li>Shoppers can no longer find or order it.</li>
            <li>Past orders keep their own copy of the item.</li>
            {product.ratingCount > 0 ? (
              <li>
                Its {pluralize(product.ratingCount, 'review')} {product.ratingCount === 1 ? 'is' : 'are'}{' '}
                deleted too.
              </li>
            ) : null}
          </ul>
          {product.active ? (
            <p>To take it off the shelf for a while, hide it instead. You can switch it back on any time.</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
