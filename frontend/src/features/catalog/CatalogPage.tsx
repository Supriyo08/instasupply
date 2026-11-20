import { PageHeader } from '@/components/ui/Layout';
import { useSignedInUser } from '@/features/auth/AuthProvider';

import { CatalogWorkspace } from './CatalogWorkspace';

/**
 * Ops `/catalog` (MARKETPLACE §9, CLIENTS §4.5): every store's listings with a store filter, the
 * staff-only fields (`featured`, `badge`, `familyKey`) and the categories tab (defaults, synonyms).
 * Deleting a product is for admins.
 */
export default function CatalogPage() {
  const { isAdmin } = useSignedInUser();
  return (
    <>
      <PageHeader
        title="Catalog"
        description="Listings across every store: prices, stock, artwork and what the app features."
      />
      <CatalogWorkspace staff canDelete={isAdmin} categoriesTab />
    </>
  );
}
