import {
  CALLABLES,
  type AssignDeliveryRequest,
  type CompleteDeliveryRequest,
  type OkResponse,
  type OptimizeRouteRequest,
  type OptimizeRouteResponse,
  type RegisterDriverRequest,
  type RegisterDriverResponse,
  type RequestPhoneOtpRequest,
  type RequestPhoneOtpResponse,
  type SendTestNotificationResponse,
  type UpdateDeliveryStatusRequest,
  type UpdateDeliveryStatusResponse,
  type VerifyPhoneOtpRequest,
  type VerifyPhoneOtpResponse,
} from '@instasupply/shared';
import { httpsCallable } from 'firebase/functions';

import { functions } from './firebase';

/** Request/response pairs for each callable this app uses. */
interface CallableMap {
  registerDriver: [RegisterDriverRequest, RegisterDriverResponse];
  requestPhoneOtp: [RequestPhoneOtpRequest, RequestPhoneOtpResponse];
  verifyPhoneOtp: [VerifyPhoneOtpRequest, VerifyPhoneOtpResponse];
  updateDeliveryStatus: [UpdateDeliveryStatusRequest, UpdateDeliveryStatusResponse];
  completeDelivery: [CompleteDeliveryRequest, OkResponse];
  optimizeRoute: [OptimizeRouteRequest, OptimizeRouteResponse];
  assignDelivery: [AssignDeliveryRequest, OkResponse];
  sendTestNotification: [void, SendTestNotificationResponse];
}

export async function call<Name extends keyof CallableMap>(
  name: Name,
  data: CallableMap[Name][0],
): Promise<CallableMap[Name][1]> {
  const callable = httpsCallable<CallableMap[Name][0], CallableMap[Name][1]>(functions, CALLABLES[name]);
  const result = await callable(data);
  return result.data;
}
