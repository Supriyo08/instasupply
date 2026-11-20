import { PageHeader } from '@/components/ui/Layout';
import { useSupplier } from '@/features/auth/AuthProvider';
import { StoreProfileEditor } from '@/features/store-profile';

/**
 * `/portal/store` (MARKETPLACE §8, CLIENTS §4.4): the profile and hours editors. The private settings
 * (order-alert mobile, loading notes) are read and written by the owner only: `storeSettings` is an
 * owner query.
 */
export default function StoreProfilePage() {
  const { storeId, isOwner } = useSupplier();
  return (
    <>
      <PageHeader title="Store" description="Your hours, contact details and how you fulfil orders." />
      <StoreProfileEditor storeId={storeId} withPrivate={isOwner} />
    </>
  );
}
