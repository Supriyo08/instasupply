import { describeError, errorStatusOf, isNetworkError } from '@instasupply/api-client';
import { useRef, useState } from 'react';

import { verifyPhoneCode } from '@/features/session/auth-service';

import { useCountdown } from './motion';
import { CODE_LENGTH } from './OtpInput';
import { forgetCodeRequest, formatPhone, nextResendAt, resendAt, sendPhoneCode } from './phone';

/** Connection problems keep the typed code so the user can simply retry; anything else clears it. */
function keepsCode(error: unknown) {
  return isNetworkError(error) || errorStatusOf(error) === 'internal';
}

/**
 * State for the "enter your code" screen: auto-submits once six digits are in, resends with the
 * backend's cooldown, and surfaces errors. Success needs no navigation; the session moves on.
 */
export function usePhoneCode(phone: string | null, initialDevCode: string | null) {
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(initialDevCode);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const { remaining, restart } = useCountdown(nextResendAt(phone));
  const busy = useRef(false);

  const verify = async (value: string) => {
    if (busy.current || value.length !== CODE_LENGTH) return;
    busy.current = true;
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      await verifyPhoneCode(value);
      forgetCodeRequest();
      setVerified(true);
    } catch (cause) {
      setError(describeError(cause));
      if (!keepsCode(cause)) setCode('');
      busy.current = false;
      setVerifying(false);
    }
  };

  const changeCode = (value: string) => {
    if (busy.current) return;
    setCode(value);
    setError(null);
    if (value.length === CODE_LENGTH) void verify(value);
  };

  const resend = async () => {
    if (!phone || sending || busy.current) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const request = await sendPhoneCode(phone);
      setDevCode(request.devCode);
      restart(resendAt(request));
      setCode('');
      setNotice(`We sent a new code to ${formatPhone(request.phone)}.`);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSending(false);
    }
  };

  return {
    code,
    devCode,
    error,
    notice,
    verifying,
    verified,
    sending,
    resendIn: remaining,
    changeCode,
    verify: () => void verify(code),
    resend: () => void resend(),
  };
}
