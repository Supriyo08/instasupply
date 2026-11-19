import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

/** Thin line icons (Feather) match the Big Cart design; Ionicons covers filled glyphs. */
export type IconName = ComponentProps<typeof Feather>['name'];
export type FilledIconName = ComponentProps<typeof Ionicons>['name'];

export function Icon(props: ComponentProps<typeof Feather>) {
  return <Feather {...props} />;
}

export function FilledIcon(props: ComponentProps<typeof Ionicons>) {
  return <Ionicons {...props} />;
}
