import { formatMoney } from '@instasupply/shared';

import { Text, type TextProps } from './Text';

/** An amount in cents as "$47.75" (MARKETPLACE §3: integer cents, CAD). */
export function Money({ cents, ...props }: { cents: number } & Omit<TextProps, 'children'>) {
  return <Text {...props}>{formatMoney(cents)}</Text>;
}
