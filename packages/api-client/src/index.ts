// Core exports: no React, no DOM-only API beyond fetch, WebSocket and AbortController, no React Native module.

export { createApiClient, type ApiClient, type ApiClientOptions } from './client';
export * from './contract';
export {
  ApiError,
  describeError,
  detailsFor,
  errorCodeOf,
  errorStatusOf,
  isApiError,
  isNetworkError,
  toApiError,
  type ApiErrorInit,
  type ApiErrorStatus,
  type ErrorDetailsByCode,
  type ServerErrorStatus,
  type TransportErrorStatus,
} from './errors';
export {
  STORAGE_KEYS,
  systemClock,
  type Clock,
  type KeyValueStorage,
  type Lifecycle,
  type LifecycleEvent,
  type PlatformBindings,
  type RefreshLock,
  type SecretStorage,
  type StoredSession,
  type WebSocketFactory,
  type WebSocketLike,
} from './platform';
export { newRequestId, canonicalJson } from './ids';
export { DEFAULT_MAP_TILES, type ConfigStore } from './config';
export type { CoreStatus, SessionCore, SessionEndReason, SessionSnapshot, SessionUser } from './auth/session';
export {
  CALL_INVALIDATIONS,
  type Call,
  type CallableMap,
  type CallableName,
  type CallOptions,
} from './callables';
export { readAll, type Rest, type RequestOptions } from './rest';
export type { QueryValue } from './http';
export {
  UPLOAD_LIMITS,
  validateUpload,
  type UploadInput,
  type UploadLimit,
  type UploadSource,
} from './uploads';
export { topics, type OpsArea, type Topics } from './topics';
export type { LiveClient, LiveEvent, LiveState } from './live/live-client';
export type { ClientFrame, ServerFrame } from './live/protocol';
export { reconnectDelay } from './live/backoff';
export {
  REFETCH,
  type PagedQueryDescriptor,
  type QueryCache,
  type QueryContext,
  type QueryDescriptor,
  type QueryKey,
  type QueryResult,
} from './query/types';
export { mergeFirstPage, type PagedState } from './query/paged';
export type { MutationOptions, OptimisticCache } from './query/mutation';
export { queries, ORDER_STATES, type Queries, type OrderState } from './queries';
export { productIdFor, storeThreadId, type Resources } from './resources';
export {
  LocationPublisher,
  TRACKING_PROFILES,
  type PublishOutcome,
  type PublisherState,
  type TrackingProfile,
} from './driver/location-publisher';
