import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { callPhone } from '@/lib/links';
import { notify } from '@/lib/notify';

import { displayPhone } from './format';

/** "Call support": dial the support line from `/config` on phones; show the number on the web. */
export async function contactSupport() {
  const phone = api.config.get()?.supportPhone ?? null;
  if (!phone) {
    notify('Help & support', 'Support is not set up yet. Please try the support chat instead.');
    return;
  }
  const message = `Call us on ${displayPhone(phone)} for help with orders, payments or deliveries.`;
  if (Platform.OS === 'web') {
    notify('Help & support', message);
    return;
  }
  try {
    await callPhone(phone);
  } catch {
    notify('Help & support', message);
  }
}
