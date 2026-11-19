import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DeleteIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/firebase/callables';

import type { CategoryRecord } from '../hooks';
import { deleteCategory } from '../mutations';
import { ArtThumb } from './ArtThumb';

/** Admin-only delete of an empty category. */
export function DeleteCategoryDialog({
  category,
  open,
  onClose,
}: {
  category: CategoryRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!category) return;
    setBusy(true);
    try {
      await deleteCategory(category.id);
      toast.success(`${category.name} deleted`);
      onClose();
    } catch (error) {
      toast.error(`Couldn't delete ${category.name}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && !!category}
      onClose={onClose}
      size="sm"
      title={category ? `Delete ${category.name}?` : 'Delete category'}
      description="It disappears from the shop's category list. This can't be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={DeleteIcon} loading={busy} onClick={() => void confirm()}>
            Delete category
          </Button>
        </>
      }
    >
      {category ? (
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <ArtThumb artKey={category.iconKey} tint={category.tint} shape="circle" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium text-slate-900">{category.name}</p>
            <p className="font-mono text-xs text-slate-500">{category.id}</p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
