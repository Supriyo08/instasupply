/**
 * InstaSupply Cloud Functions entry point. This file only wires exports; logic lives in modules/.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

import { region } from './config/runtime';

setGlobalOptions({ region, maxInstances: 20 });

// Auth & accounts
export { registerDriver } from './modules/auth/register-driver';
export { requestPhoneOtp, verifyPhoneOtp } from './modules/auth/phone-otp';
export { setDriverStatus } from './modules/auth/driver-status';
export { createStaffUser } from './modules/auth/staff';

// Deliveries
export { createDeliveries } from './modules/deliveries/create-deliveries';
export { assignDelivery } from './modules/deliveries/assign-delivery';
export { updateDeliveryStatus, completeDelivery } from './modules/deliveries/update-status';
export { onDeliveryWritten } from './modules/deliveries/on-delivery-written';

// Routing, geocoding & tracking
export { optimizeRoute } from './modules/routing/optimize-route';
export { geocodeAddress } from './modules/geocoding/geocoder';
export { onDriverLocationWritten } from './modules/tracking/triggers';

// Messaging
export { onNotificationCreated, sendTestNotification } from './modules/notifications/triggers';
export { onDeviceWritten } from './modules/notifications/device-tokens';
export { onChatMessageCreated } from './modules/chat/on-message-created';

// Customer commerce
export { registerCustomer } from './modules/commerce/register-customer';
export { placeOrder } from './modules/commerce/place-order';
export { cancelOrder } from './modules/commerce/cancel-order';
export { onReviewWritten } from './modules/commerce/reviews';

// Maintenance
export { markStaleDriversOffline } from './modules/maintenance/scheduled';
