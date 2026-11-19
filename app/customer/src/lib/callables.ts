import { createCaller } from '@instasupply/expo-firebase';
import {
  CALLABLES,
  type CancelOrderRequest,
  type OkResponse,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type RegisterCustomerRequest,
  type RegisterCustomerResponse,
  type RequestPhoneOtpRequest,
  type RequestPhoneOtpResponse,
  type SendTestNotificationResponse,
  type VerifyPhoneOtpRequest,
  type VerifyPhoneOtpResponse,
} from '@instasupply/shared';

import { functions } from './firebase';

interface CustomerCallables extends Record<string, [unknown, unknown]> {
  registerCustomer: [RegisterCustomerRequest, RegisterCustomerResponse];
  requestPhoneOtp: [RequestPhoneOtpRequest, RequestPhoneOtpResponse];
  verifyPhoneOtp: [VerifyPhoneOtpRequest, VerifyPhoneOtpResponse];
  placeOrder: [PlaceOrderRequest, PlaceOrderResponse];
  cancelOrder: [CancelOrderRequest, OkResponse];
  sendTestNotification: [void, SendTestNotificationResponse];
}

export const call = createCaller<CustomerCallables>(functions, {
  registerCustomer: CALLABLES.registerCustomer,
  requestPhoneOtp: CALLABLES.requestPhoneOtp,
  verifyPhoneOtp: CALLABLES.verifyPhoneOtp,
  placeOrder: CALLABLES.placeOrder,
  cancelOrder: CALLABLES.cancelOrder,
  sendTestNotification: CALLABLES.sendTestNotification,
});
