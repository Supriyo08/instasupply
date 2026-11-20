import { queries } from '@instasupply/api-client';
import { useLiveQuery } from '@instasupply/api-client/react';
import type { Jobsite, JobsiteFields } from '@instasupply/shared';

import { api } from '@/lib/api';
import { newRequestId } from '@/lib/ids';

/**
 * The customer's jobsites, default first (`queries.jobsites`). Empty for guests, without a request.
 * `defaultJobsite` is the one marked default, else the first.
 */
export function useJobsites(uid: string | null | undefined) {
  const result = useLiveQuery(queries.jobsites(uid));
  const defaultJobsite = result.data.find((site) => site.isDefault) ?? result.data[0] ?? null;
  return { ...result, defaultJobsite };
}

/** Creates (no `id`) or replaces a jobsite. The server clears the other defaults in the same write. */
export function saveJobsite(
  fields: JobsiteFields & { id?: string | null; isDefault: boolean },
): Promise<Jobsite> {
  const { id, ...rest } = fields;
  return api.jobsites.save({ ...rest, id: id || newRequestId() });
}

export function deleteJobsite(id: string): Promise<unknown> {
  return api.jobsites.remove(id);
}

/** Re-saves the jobsite with `isDefault: true`; the server clears the old default. */
export function setDefaultJobsite(jobsite: Jobsite): Promise<Jobsite> {
  return api.jobsites.save({ ...jobsiteFields(jobsite), id: jobsite.id, isDefault: true });
}

/** The editable part of a stored jobsite (drops id, default flag and server stamps). */
export function jobsiteFields(jobsite: Jobsite): JobsiteFields {
  const {
    id: _id,
    isDefault: _isDefault,
    lastUsedAt: _lastUsedAt,
    createdAt: _c,
    updatedAt: _u,
    ...fields
  } = jobsite;
  return fields;
}
