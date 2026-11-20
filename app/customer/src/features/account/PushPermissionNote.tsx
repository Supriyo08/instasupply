import { Platform } from 'react-native';

import { Notice } from '@/components/ui';

import type { PushPermission } from './usePushPermission';

/** Explains when this device can't show push alerts, with the fix one tap away (docs/CLIENTS.md §6.7). */
export function PushPermissionNote({ status, onEnable }: { status: PushPermission; onEnable: () => void }) {
  if (status === 'blocked') {
    return (
      <Notice
        tone="warning"
        icon="bell-off"
        title="Notifications are blocked"
        message="Push alerts are turned off for InstaSupply on this device. Turn them on in your phone's settings to hear about your deliveries."
        actionLabel="Open settings"
        onAction={onEnable}
      />
    );
  }
  if (status === 'ask') {
    return (
      <Notice
        tone="info"
        icon="bell"
        title="Get delivery updates"
        message="Get a heads-up when a store confirms your order and when the truck is on its way to your site."
        actionLabel="Allow"
        onAction={onEnable}
      />
    );
  }
  if (status === 'unsupported') {
    return (
      <Notice
        tone="info"
        icon="smartphone"
        message={
          Platform.OS === 'web'
            ? 'Push alerts go to the InstaSupply mobile app. On the web, updates appear in your inbox.'
            : "Push alerts aren't set up in this build. Updates appear in your inbox."
        }
      />
    );
  }
  return null;
}
