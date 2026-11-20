/** The Team, Catalog, Orders and Reviews tabs of the ops store page (MARKETPLACE §9, CLIENTS §4.5). */
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  CATEGORIES,
  availableQty,
  formatDateTimeET,
  formatMoney,
  type Product,
  type StoreRole,
  type UserProfile,
} from '@instasupply/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyField } from '@/components/ui/CopyField';
import { LoadMore } from '@/components/ui/Data';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Field, Select, TextInput, Toggle } from '@/components/ui/Form';
import { DeleteIcon, ExternalLinkIcon, InviteIcon, StarIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { ActionDialog } from '@/features/orders/components/ActionDialog';
import { ArtEmptyState, ItemThumb } from '@/features/orders/components/ItemThumb';
import { StoreOrdersTable } from '@/features/orders/components/StoreOrdersTable';
import { useOpsStoreOrders } from '@/features/orders/hooks';
import { api, call, describeError, queries } from '@/lib/api';
import { useNow } from '@/lib/data';

// ---------- team ----------

function InviteDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StoreRole>('staff');
  const [link, setLink] = useState<string | null>(null);

  if (link) {
    return (
      <ActionDialog
        open
        onClose={onClose}
        title="Invite sent"
        confirmLabel="Done"
        onConfirm={async () => undefined}
      >
        <p className="text-sm text-slate-700">
          Send this link to {email}. It lets them choose a password and sign in to the supplier portal.
        </p>
        <CopyField value={link} label="Set-password link" />
      </ActionDialog>
    );
  }
  return (
    <ActionDialog
      open
      onClose={onClose}
      title="Invite to the store"
      description="Owners also see payouts, insights and the team; staff run orders and the catalogue."
      confirmLabel="Create invite"
      confirmDisabled={name.trim().length < 2 || !email.includes('@')}
      onConfirm={async () => {
        const response = await call('inviteSupplierUser', {
          storeId,
          email: email.trim(),
          displayName: name.trim(),
          storeRole: role,
        });
        setLink(response.passwordSetupLink);
        // Keep the dialog open to show the link.
        throw new KeepOpen();
      }}
      explainError={(error) => (error instanceof KeepOpen ? '' : describeError(error))}
    >
      <Field label="Name" required>
        {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      <Field label="Email" required>
        {(id) => (
          <TextInput id={id} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        )}
      </Field>
      <Field label="Role">
        {(id) => (
          <Select id={id} value={role} onChange={(event) => setRole(event.target.value as StoreRole)}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </Select>
        )}
      </Field>
    </ActionDialog>
  );
}

/** Thrown to keep the invite dialog open on success, so it can show the link. */
class KeepOpen extends Error {}

export function TeamTab({ storeId }: { storeId: string }) {
  const toast = useToast();
  const team = useLiveQuery(queries.storeTeam(storeId));
  const [inviting, setInviting] = useState(false);
  const [target, setTarget] = useState<UserProfile | null>(null);

  return (
    <Card>
      <CardHeader
        title="Team"
        description="People who sign in to this store's supplier portal."
        action={
          <Button size="sm" icon={InviteIcon} onClick={() => setInviting(true)}>
            Invite
          </Button>
        }
      />
      {team.error && team.data.length === 0 ? (
        <ErrorState error={team.error} onRetry={team.retry} className="m-5" />
      ) : team.loading && team.data.length === 0 ? (
        <PageSpinner label="Loading the team" />
      ) : team.data.length === 0 ? (
        <ArtEmptyState
          artKey="scene-welcome"
          title="Nobody yet"
          description="Invite the owner so the store can accept orders in the portal."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {team.data.map((member) => (
            <li key={member.uid} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{member.displayName}</p>
                <p className="text-xs text-slate-500">{member.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={member.storeRole === 'owner' ? 'brand' : 'neutral'}>
                  {member.storeRole === 'owner' ? 'Owner' : 'Staff'}
                </Badge>
                <Badge
                  tone={
                    member.status === 'active'
                      ? 'success'
                      : member.status === 'pending'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {member.status === 'active'
                    ? 'Active'
                    : member.status === 'pending'
                      ? 'Invited'
                      : 'Suspended'}
                </Badge>
                <Button size="sm" variant="secondary" onClick={() => setTarget(member)}>
                  {member.status === 'suspended' ? 'Restore' : 'Suspend'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {inviting ? <InviteDialog storeId={storeId} onClose={() => setInviting(false)} /> : null}
      {target ? (
        <ConfirmDialog
          open
          onClose={() => setTarget(null)}
          tone={target.status === 'suspended' ? 'primary' : 'danger'}
          title={
            target.status === 'suspended'
              ? `Restore ${target.displayName}?`
              : `Suspend ${target.displayName}?`
          }
          description={
            target.status === 'suspended'
              ? 'They can sign in to the supplier portal again.'
              : 'They are signed out everywhere at once and cannot sign in until restored.'
          }
          confirmLabel={target.status === 'suspended' ? 'Restore' : 'Suspend'}
          onConfirm={async () => {
            await call('setSupplierUserStatus', {
              uid: target.uid,
              status: target.status === 'suspended' ? 'active' : 'suspended',
            });
            toast.success(target.status === 'suspended' ? 'Access restored' : 'Access suspended');
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------- catalogue ----------

function ActiveSwitch({ product }: { product: Product }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Toggle
      checked={product.active}
      disabled={busy}
      label={product.active ? 'Active' : 'Hidden'}
      onChange={(active) => {
        setBusy(true);
        api.products
          .update(product.id, { active })
          .catch((error: unknown) => toast.error("Couldn't change the listing", describeError(error)))
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function CatalogTab({ storeId }: { storeId: string }) {
  const catalog = useLiveQuery(queries.portalCatalog(storeId));
  return (
    <Card>
      <CardHeader
        title="Catalogue"
        description="Every product of the store, active or not. Edit prices and stock in the catalogue workspace."
        action={
          <Link
            to={`/catalog?store=${encodeURIComponent(storeId)}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            Open in Catalog <ExternalLinkIcon size={14} aria-hidden />
          </Link>
        }
      />
      {catalog.error && catalog.data.length === 0 ? (
        <ErrorState error={catalog.error} onRetry={catalog.retry} className="m-5" />
      ) : catalog.loading && catalog.data.length === 0 ? (
        <PageSpinner label="Loading the catalogue" />
      ) : catalog.data.length === 0 ? (
        <ArtEmptyState
          artKey="scene-material-list"
          title="No products yet"
          description="Add the store's catalogue in Catalog."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Products of the store</caption>
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Product
                </th>
                <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">
                  Category
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Price
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  On hand
                </th>
                <th scope="col" className="hidden px-3 py-3 text-right font-medium sm:table-cell">
                  Reserved
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Available
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Listing
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catalog.data.map((product) => (
                <tr key={product.id}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <ItemThumb item={product} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{product.name}</p>
                        <p className="text-xs text-slate-500">
                          {[product.sku, product.brand, product.size, product.unit]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 text-slate-600 md:table-cell">
                    {CATEGORIES[product.categoryId]?.name ?? product.categoryId}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(product.priceCents)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{product.stockOnHand}</td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">
                    {product.reserved}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{availableQty(product)}</td>
                  <td className="px-5 py-2.5">
                    <ActiveSwitch product={product} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------- orders ----------

export function StoreOrdersTab({ storeId }: { storeId: string }) {
  const now = useNow();
  const orders = useOpsStoreOrders({ storeId });
  return (
    <Card className="overflow-hidden">
      {orders.error && orders.items.length === 0 ? (
        <ErrorState error={orders.error} onRetry={orders.retry} className="m-5" />
      ) : orders.loading && orders.items.length === 0 ? (
        <PageSpinner label="Loading orders" />
      ) : orders.items.length === 0 ? (
        <ArtEmptyState artKey="scene-jobsite-delivery" title="No orders yet" />
      ) : (
        <>
          <StoreOrdersTable storeOrders={orders.items} now={now} showStore={false} />
          <LoadMore hasMore={orders.hasMore} loadingMore={orders.loadingMore} onLoadMore={orders.loadMore} />
        </>
      )}
    </Card>
  );
}

// ---------- reviews ----------

export function ReviewsTab({ storeId }: { storeId: string }) {
  const toast = useToast();
  const reviews = usePagedQuery(queries.storeReviews(storeId), { live: false });
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Reviews"
        description="One rating per completed store order. Remove abusive ones only."
      />
      {reviews.error && reviews.items.length === 0 ? (
        <ErrorState error={reviews.error} onRetry={reviews.retry} className="m-5" />
      ) : reviews.loading && reviews.items.length === 0 ? (
        <PageSpinner label="Loading reviews" />
      ) : reviews.items.length === 0 ? (
        <CardBody>
          <p className="text-sm text-slate-500">No reviews yet.</p>
        </CardBody>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {reviews.items.map((review) => (
              <li key={review.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-flex items-center gap-0.5 text-amber-500"
                      aria-label={`${review.rating} out of 5`}
                    >
                      {Array.from({ length: 5 }, (_, index) => (
                        <StarIcon
                          key={index}
                          size={14}
                          aria-hidden
                          className={index < review.rating ? 'fill-current' : 'text-slate-300'}
                        />
                      ))}
                    </span>
                    <span className="font-medium text-slate-900">{review.authorName}</span>
                    <span className="text-xs text-slate-500">{formatDateTimeET(review.updatedAt)}</span>
                  </p>
                  {review.text ? <p className="mt-1 text-sm text-slate-700">{review.text}</p> : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={DeleteIcon}
                  aria-label={`Remove the review by ${review.authorName}`}
                  onClick={() => setRemoving(review.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <LoadMore
            hasMore={reviews.hasMore}
            loadingMore={reviews.loadingMore}
            onLoadMore={reviews.loadMore}
          />
        </>
      )}
      {removing ? (
        <ConfirmDialog
          open
          tone="danger"
          onClose={() => setRemoving(null)}
          title="Remove this review?"
          description="It disappears from the store page and the store's rating is recalculated. This cannot be undone."
          confirmLabel="Remove review"
          onConfirm={async () => {
            await api.reviews.remove(storeId, removing);
            toast.success('Review removed');
          }}
        />
      ) : null}
    </Card>
  );
}
