/**
 * The store commands (MARKETPLACE §5.4, docs/PLATFORM.md §5.2, §9.2.13): `createStore` and
 * `updateStoreSettings` (admin), `updateStoreProfile` (staff; the owner for every field; any member for
 * `acceptingOrders` alone). Stores are never client-writable otherwise.
 *
 * Locks: stores (rank 8) → products of the store, in id order (rank 10), for the fan-out of name and status.
 */
import {
  isValidEmail,
  localDateOf,
  normalizePhone,
  validateStore,
  validateStoreProfile,
  type CreateStoreRequest,
  type StorePrivateSettings,
  type StoreProfilePatch,
  type UpdateStoreProfileRequest,
  type UpdateStoreSettingsRequest,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { fail, invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { requireReadyFile } from '../../platform/storage/files.service';
import { notifyStaff } from '../notifications/notify';
import { isStaffOrMember, isStaffOrOwner, validOrThrow } from './access';
import { fanOutStore } from './store-fanout';
import {
  findStoreSettings,
  insertStore,
  lockStore,
  saveStoreDoc,
  saveStoreSettings,
  type StoreDoc,
} from './stores.repository';

/** The checks of the private settings that the shared validators do not cover (§5.4: commission 0–3 000). */
function cleanSettings(settings: StorePrivateSettings): StorePrivateSettings {
  const fields: Record<string, string> = {};
  let alertPhone: string | null = null;
  if (settings.alertPhone !== null) {
    alertPhone = normalizePhone(settings.alertPhone);
    if (!alertPhone) fields['settings.alertPhone'] = 'Enter a Canadian or US mobile number for order alerts.';
  }
  const ordersEmail = settings.ordersEmail === null ? null : settings.ordersEmail.trim().toLowerCase();
  if (ordersEmail !== null && !isValidEmail(ordersEmail)) {
    fields['settings.ordersEmail'] = 'Enter a valid email address for orders, or none.';
  }
  const loadingNotes = settings.loadingNotes?.trim() || null;
  const notes = settings.notes?.trim() || null;
  const first = Object.values(fields)[0];
  if (first) invalidArgument(first, { fields });
  return { ...settings, alertPhone, ordersEmail, loadingNotes, notes };
}

/** A store document as validateStore sees it: the public shape with `photoUrl` instead of `photoPath`. */
function asStoreInput(doc: StoreDoc): Record<string, unknown> {
  const { photoPath: _photoPath, ...rest } = doc;
  return { ...rest, photoUrl: null };
}

/** validateStore's cleaned value, back as a document (the photo path is the stored one). */
function storeDocFrom(raw: unknown, photoPath: string | null): StoreDoc {
  const { photoUrl: _photoUrl, ...value } = validOrThrow(validateStore(raw), 'store');
  return { ...value, photoPath };
}

export async function createStore(deps: Deps, request: CreateStoreRequest): Promise<void> {
  const doc = storeDocFrom(request.store, null);
  const settings = cleanSettings(request.settings);
  await withTransaction(deps, async (tx) => {
    const inserted = await insertStore(tx, request.storeId, doc, settings);
    if (!inserted) fail('already-exists', 'A store with this id already exists. Choose another id.');
  });
}

export async function updateStoreSettings(deps: Deps, request: UpdateStoreSettingsRequest): Promise<void> {
  await withTransaction(deps, async (tx) => {
    const store = await lockStore(tx, request.storeId);
    if (!store) notFound('That store does not exist.');
    if (request.store) {
      const { deliveryRadiusKm, ...fields } = request.store;
      const merged = {
        ...asStoreInput(store.doc),
        ...fields,
        fulfilment: {
          ...store.doc.fulfilment,
          ...(deliveryRadiusKm !== undefined ? { deliveryRadiusKm } : {}),
        },
      };
      const doc = storeDocFrom(merged, store.doc.photoPath);
      await saveStoreDoc(tx, store.id, doc);
      if (doc.name !== store.doc.name || doc.status !== store.doc.status) {
        await fanOutStore(tx, { id: store.id, name: doc.name, status: doc.status });
      }
    }
    if (request.settings) {
      const current = await findStoreSettings(tx, store.id);
      if (!current) notFound('That store does not exist.');
      await saveStoreSettings(tx, store.id, cleanSettings({ ...current, ...request.settings }));
    }
  });
}

const DOC_FIELDS = [
  'description',
  'phone',
  'email',
  'hours',
  'closures',
  'prepMinutes',
  'sameDayCutoff',
  'acceptingOrders',
] as const;

/** Who may send this patch: any member for `acceptingOrders` alone, otherwise staff or the owner. */
export function checkProfileAccess(actor: Actor, storeId: string, patch: StoreProfilePatch): void {
  const keys = Object.keys(patch);
  const pauseOnly = keys.every((key) => key === 'acceptingOrders');
  const allowed = pauseOnly ? isStaffOrMember(actor, storeId) : isStaffOrOwner(actor, storeId);
  if (!allowed) permissionDenied();
}

export async function updateStoreProfile(
  deps: Deps,
  actor: Actor,
  request: UpdateStoreProfileRequest,
): Promise<void> {
  const { storeId } = request;
  checkProfileAccess(actor, storeId, request.patch);
  const now = deps.clock.now();
  const patch = validOrThrow(validateStoreProfile(request.patch, localDateOf(now), storeId), 'patch');
  if (patch.photoPath) {
    await requireReadyFile(deps.pool, patch.photoPath, { purpose: 'store_photo', scopeId: storeId });
  }
  await withTransaction(
    deps,
    async (tx) => {
      const store = await lockStore(tx, storeId);
      if (!store) notFound('That store does not exist.');
      const doc: StoreDoc = { ...store.doc };
      let docChanged = false;
      for (const key of DOC_FIELDS) {
        if (patch[key] === undefined) continue;
        Object.assign(doc, { [key]: patch[key] });
        docChanged = true;
      }
      if (patch.fulfilment) {
        doc.fulfilment = { ...doc.fulfilment, ...patch.fulfilment };
        docChanged = true;
      }
      if (patch.photoPath !== undefined) {
        doc.photoPath = patch.photoPath;
        docChanged = true;
      }
      if (docChanged) await saveStoreDoc(tx, storeId, doc);

      if (patch.loadingNotes !== undefined || patch.alertPhone !== undefined) {
        const settings = await findStoreSettings(tx, storeId);
        if (!settings) notFound('That store does not exist.');
        await saveStoreSettings(tx, storeId, {
          ...settings,
          ...(patch.loadingNotes !== undefined ? { loadingNotes: patch.loadingNotes } : {}),
          ...(patch.alertPhone !== undefined ? { alertPhone: patch.alertPhone } : {}),
        });
      }

      if (store.doc.acceptingOrders && doc.acceptingOrders === false) {
        await notifyStaff(
          tx,
          {
            type: 'system',
            title: `${doc.name} paused new orders`,
            body: `${doc.name} is not taking new orders until the store turns them back on.`,
            key: `store-paused-${storeId}-${tx.now}`,
          },
          { exclude: actor.uid },
        );
      }
    },
    { now },
  );
}
