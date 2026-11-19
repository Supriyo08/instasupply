import type { Jobsite, JobsiteFields, SavedCard } from '@instasupply/shared';

import type { DeviceInput, Favorite, ProfilePatch } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

export type { Favorite } from '../contract';

/** The caller's own data, under `/me/…` (PLATFORM §5.3.3). */
export const mePaths = {
  me: '/me',
  jobsites: '/me/jobsites',
  jobsite: (id: string) => `/me/jobsites/${seg(id)}`,
  cards: '/me/cards',
  card: (id: string) => `/me/cards/${seg(id)}`,
  favorites: '/me/favorites',
  favorite: (productId: string) => `/me/favorites/${seg(productId)}`,
  buyAgain: '/me/buy-again',
  device: (installationId: string) => `/me/devices/${seg(installationId)}`,
} as const;

export type ProfileUpdate = ProfilePatch;

export function createJobsites(ctx: ResourceContext) {
  return {
    /** Create or replace; the server clears other defaults and keeps `lastUsedAt`. */
    save: (jobsite: JobsiteFields & { id: string; isDefault: boolean }) =>
      writeThen(ctx, [['jobsites']], () => ctx.rest.put<Jobsite>(mePaths.jobsite(jobsite.id), jobsite)),
    remove: (id: string) => writeThen(ctx, [['jobsites']], () => ctx.rest.delete(mePaths.jobsite(id))),
  };
}

export function createCards(ctx: ResourceContext) {
  return {
    /** Brand, last 4, expiry, holder and the default flag only: the strict schema has no field for a number. */
    save: (card: Omit<SavedCard, 'createdAt'>) =>
      writeThen(ctx, [['cards']], () => ctx.rest.put<SavedCard>(mePaths.card(card.id), card)),
    remove: (id: string) => writeThen(ctx, [['cards']], () => ctx.rest.delete(mePaths.card(id))),
  };
}

export function createFavorites(ctx: ResourceContext) {
  return {
    add: (productId: string) =>
      writeThen(ctx, [['favorites']], () => ctx.rest.put(mePaths.favorite(productId))),
    remove: (productId: string) =>
      writeThen(ctx, [['favorites']], () => ctx.rest.delete(mePaths.favorite(productId))),
  };
}

export function createDevices(ctx: ResourceContext) {
  return {
    /** Upserts this install's push token; the server removes the same token from every other account. */
    register: async (input: DeviceInput) => ctx.rest.put(mePaths.device(await ctx.installationId()), input),
    unregister: async () => ctx.rest.delete(mePaths.device(await ctx.installationId())),
  };
}

export type FavoriteRow = Favorite & { id: string };
