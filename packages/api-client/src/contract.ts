/**
 * The REST contract of PLATFORM §5.4. Since PLATFORM §16 row 11 landed, these types come from
 * `@instasupply/shared` (`src/rest.ts`), the one definition the server reads too. Only what shared does
 * not have yet is declared here.
 */
export type {
  Page,
  WithId,
  ApiStatus,
  ApiErrorBody,
  HealthResponse,
  PublicConfig,
  ClientApp,
  RegisterRequest,
  LoginRequest,
  SetupPasswordRequest,
  AuthTokens,
  MeResponse,
  AuthSessionResponse,
  InviteInfo,
  SessionInfo,
  PayoutAccountPatch,
  UserStatusPatch,
  AuthFailureReason,
  ProfilePatch,
  JobsiteInput,
  CardInput,
  Favorite,
  DeviceInput,
  CartInput,
  Fix,
  TrackingMode,
  LocationReport,
  LocationAck,
  ProductPatch,
  CategoryInput,
  ReviewInput,
  StoreOrderProof,
  DeliveryStats,
  DeliveryPatch,
  ChatMessageInput,
  SupportMessageInput,
  SupportThreadPatch,
  AssignPatch,
  IssueNotes,
  LedgerBalance,
  UploadPurpose,
  PresignRequest,
  PresignedUpload,
  UploadedFile,
  FileUrlResponse,
  OpsDashboard,
  OpsStoreRow,
  JobState,
  OutboxEvent,
  // `catalog.ts` of shared has its own `ProductInput`; the REST body is exported under this alias.
  RestProductInput as ProductInput,
} from '@instasupply/shared';

/**
 * PLATFORM §5.4 `OutboxMessage`, a superset of the shared `DevOutboxMessage` (which knows SMS only).
 * PLATFORM §16 row 4 replaces `DevOutboxMessage` with it in shared; until then it is declared here.
 */
export interface OutboxMessage {
  id: string;
  channel: 'sms' | 'email';
  to: string;
  subject: string | null;
  /** Null when redacted: a sensitive message that a real provider delivered. */
  body: string | null;
  purpose: 'otp' | 'tracking_link' | 'store_alert' | 'other' | 'password_reset' | 'invite';
  provider: 'outbox' | 'twilio' | 'resend' | 'smtp';
  status: 'stored' | 'sent' | 'failed';
  createdAt: number;
}
