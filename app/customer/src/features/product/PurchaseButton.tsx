import { Button, type IconName } from '@/components/ui';

import type { ProductPurchase } from './useProductPurchase';

function present({ action, inCart }: ProductPurchase): {
  label: string;
  icon?: IconName;
  variant: 'primary' | 'danger';
} {
  switch (action) {
    case 'unavailable':
      return { label: 'Out of stock', variant: 'primary' };
    case 'add':
      return { label: 'Add to cart', icon: 'shopping-bag', variant: 'primary' };
    case 'update':
      return { label: 'Update cart', icon: 'shopping-bag', variant: 'primary' };
    case 'remove':
      return { label: 'Remove from cart', icon: 'trash-2', variant: 'danger' };
    case 'view':
      return { label: `In cart: ${inCart} · View cart`, icon: 'arrow-right', variant: 'primary' };
  }
}

/** The pinned gradient button of the product page; its label follows the cart state. */
export function PurchaseButton({ purchase }: { purchase: ProductPurchase }) {
  const { label, icon, variant } = present(purchase);
  return (
    <Button
      label={label}
      variant={variant}
      trailingIcon={icon}
      disabled={purchase.action === 'unavailable'}
      onPress={purchase.commit}
    />
  );
}
