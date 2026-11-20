import { PageHeader } from '@/components/ui/Layout';
import { useSupplier } from '@/features/auth/AuthProvider';
import { CatalogWorkspace } from '@/features/catalog';

/**
 * `/portal/catalog` (MARKETPLACE §8, CLIENTS §4.4): the store's own listings. Owners may delete a
 * product that no open order holds; everyone on the team can edit prices, counts and listings.
 */
export default function PortalCatalogPage() {
  const { storeId, isOwner } = useSupplier();
  return (
    <>
      <PageHeader
        title="Catalog"
        description="What contractors can order from you. On hand is your shelf count; reserved units are promised to open orders."
      />
      <CatalogWorkspace storeId={storeId} canDelete={isOwner} />
    </>
  );
}
