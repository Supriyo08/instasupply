import { createCategories, createProducts, createReviews } from './catalog';
import { createChat } from './chat';
import type { ResourceContext } from './context';
import { createDeliveries } from './deliveries';
import { createFiles } from './files';
import { createIssues } from './issues';
import { createLocation } from './location';
import { createCards, createDevices, createFavorites, createJobsites } from './me';
import { createNotifications } from './notifications';
import { createSuggestions } from './ops';
import { createQuotes } from './quotes';
import { createSupport } from './support';
import { createUsers } from './users';

export type { ResourceContext } from './context';

/** The REST write namespaces of CLIENTS §4.2, carried by the client as `api.<resource>`. */
export function createResources(ctx: ResourceContext) {
  return {
    jobsites: createJobsites(ctx),
    cards: createCards(ctx),
    favorites: createFavorites(ctx),
    reviews: createReviews(ctx),
    notifications: createNotifications(ctx),
    devices: createDevices(ctx),
    location: createLocation(ctx),
    chat: createChat(ctx),
    support: createSupport(ctx),
    products: createProducts(ctx),
    categories: createCategories(ctx),
    deliveries: createDeliveries(ctx),
    quotes: createQuotes(ctx),
    issues: createIssues(ctx),
    suggestions: createSuggestions(ctx),
    files: createFiles(ctx),
    users: createUsers(ctx),
  };
}

export type Resources = ReturnType<typeof createResources>;

export { catalogPaths, productIdFor } from './catalog';
export { chatPaths } from './chat';
export { deliveryPaths } from './deliveries';
export { filePaths } from './files';
export { financePaths } from './finance';
export { issuePaths } from './issues';
export { jobPaths } from './jobs';
export { locationPaths } from './location';
export { mePaths } from './me';
export { notificationPaths } from './notifications';
export { opsPaths } from './ops';
export { orderPaths } from './orders';
export { quotePaths } from './quotes';
export { storeThreadId, supportPaths } from './support';
export { userPaths } from './users';
