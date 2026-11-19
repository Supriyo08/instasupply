import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { callPhone } from '@/lib/links';
import { notify } from '@/lib/notify';

import { displayPhone } from './format';

/** "Help" row: dial the support line on phones; show the number on the web. */
export async function contactSupport() {
  const phone = env.supportPhone;
  if (!phone) {
    notify('Help & support', 'Support is not set up for this build yet. Please try again later.');
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
