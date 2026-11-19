import type { ChatMessage, ChatThread, Delivery, DeliveryEvent, JobOffer, RoutePlan } from '@instasupply/shared';

import type { DeliveryStats, WithId } from '../contract';
import { chatPaths } from '../resources/chat';
import { deliveryPaths } from '../resources/deliveries';
import { jobPaths } from '../resources/jobs';
import { topics } from '../topics';

import { appendMessage, docQuery, idOrNull, listQuery, pagedQuery, valueQuery } from './helpers';

const ACTIVE = ['assigned', 'accepted', 'picked_up', 'in_transit', 'arrived'];
const CLOSED = ['delivered', 'failed', 'cancelled'];

function boardTopics(cityId: string | null, capacityClass: string | null): string[] {
  return cityId && capacityClass ? [topics.jobOffers(cityId, capacityClass)] : [];
}

export const driverQueries = {
  /** The server returns only offers whose audience matches the caller's own city and class. */
  jobBoard: (cityId: string | null | undefined, capacityClass: string | null | undefined) => {
    const city = idOrNull(cityId);
    const cls = idOrNull(capacityClass);
    return listQuery<WithId<JobOffer>>(
      ['job-offers', 'board', city, cls],
      city !== null && cls !== null,
      jobPaths.offers,
      { status: 'open', sort: 'openedAt:desc' },
      { limit: 200, topics: boardTopics(city, cls), pollS: 20 },
    );
  },

  /** 404 is null: the job was taken or withdrawn. */
  jobOffer: (
    deliveryId: string | null | undefined,
    cityId: string | null | undefined,
    capacityClass: string | null | undefined,
  ) => {
    const id = idOrNull(deliveryId);
    return docQuery<WithId<JobOffer>>(['job-offer', id], id !== null, () => jobPaths.offer(id ?? ''), {
      topics: boardTopics(idOrNull(cityId), idOrNull(capacityClass)),
      pollS: 20,
    });
  },

  driverActiveDeliveries: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<Delivery>(
      ['deliveries', 'driver', id, 'active'],
      id !== null,
      deliveryPaths.deliveries,
      { driverId: id, status: ACTIVE },
      { limit: 50, topics: id ? [topics.driverDeliveries(id)] : [], pollS: 15 },
    );
  },

  driverHistory: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return pagedQuery<Delivery>(
      ['deliveries', 'driver', id, 'closed'],
      id !== null,
      deliveryPaths.deliveries,
      { driverId: id, status: CLOSED, sort: 'updatedAt:desc' },
      { topics: id ? [topics.driverDeliveries(id)] : [] },
    );
  },

  delivery: (deliveryId: string | null | undefined) => {
    const id = idOrNull(deliveryId);
    return docQuery<Delivery>(['delivery', id], id !== null, () => deliveryPaths.delivery(id ?? ''), {
      topics: id ? [topics.delivery(id)] : [],
      pollS: 10,
    });
  },

  deliveryEvents: (deliveryId: string | null | undefined) => {
    const id = idOrNull(deliveryId);
    return listQuery<DeliveryEvent>(['delivery-events', id], id !== null, deliveryPaths.events(id ?? ''), {}, {
      limit: 30,
      follow: false,
      topics: id ? [topics.delivery(id)] : [],
      pollS: 30,
    });
  },

  deliveryStats: (driverId: string | null | undefined, sinceMs: number) => {
    const id = idOrNull(driverId);
    return valueQuery<DeliveryStats>(
      ['delivery-stats', id, sinceMs],
      id !== null,
      { delivered: 0, failed: 0 },
      () => deliveryPaths.stats,
      () => ({ driverId: id, since: sinceMs }),
      { topics: id ? [topics.driverDeliveries(id)] : [] },
    );
  },

  route: (driverId: string | null | undefined) => {
    const id = idOrNull(driverId);
    return docQuery<RoutePlan>(['route', id], id !== null, () => deliveryPaths.route(id ?? ''), {
      topics: id ? [topics.driverRoute(id)] : [],
      pollS: 30,
    });
  },

  chatThread: (driverId: string | null | undefined) => {
    const id = idOrNull(driverId);
    return docQuery<WithId<ChatThread>>(['chat-thread', id], id !== null, () => chatPaths.thread(id ?? ''), {
      topics: id ? [topics.chatThread(id)] : [],
      pollS: 15,
    });
  },

  chatMessages: (driverId: string | null | undefined) => {
    const id = idOrNull(driverId);
    return listQuery<ChatMessage>(['chat-messages', id], id !== null, chatPaths.messages(id ?? ''), {}, {
      limit: 100,
      follow: false,
      topics: id ? [topics.chatThread(id)] : [],
      pollS: 10,
      reduce: appendMessage,
    });
  },
};
