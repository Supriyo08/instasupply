import { Notice } from '@/components/ui';

import type { PushPermission } from './usePushPermission';

/** Explains when this device can't show push alerts, with the fix one tap away. */
export function PushPermissionNote({ status, onEnable }: { status: PushPermission; onEnable: () => void }) {
  if (status === 'blocked') {
    return (
      <Notice
        tone="warning"
        icon="bell-off"
        title="Notifications are blocked"
        message="Push alerts are turned off for InstaSupply on this device. Turn them on in Settings to hear about your orders."
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
        title="Allow notifications"
        message="Get a heads-up when your order is confirmed and when your driver is nearby."
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
        message="Push alerts go to the InstaSupply mobile app. On the web, updates appear in your notification inbox."
      />
    );
  }
  return null;
}
