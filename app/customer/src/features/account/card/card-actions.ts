import type { SavedCard } from '@instasupply/shared';

import { deleteCard, setDefaultCard } from '@/features/cards/hooks';

import { isCardExpired } from './card-format';

/** Delete a card; if it was the default, the next valid card becomes the default. */
export async function removeCard(card: SavedCard, all: SavedCard[]) {
  await deleteCard(card.id);
  if (!card.isDefault) return;
  const remaining = all.filter((item) => item.id !== card.id);
  const next = remaining.find((item) => !isCardExpired(item));
  if (next) await setDefaultCard(next);
}

/** Same brand, last 4 and expiry as a card already on file. */
export function isDuplicateCard(
  cards: SavedCard[],
  candidate: Pick<SavedCard, 'brand' | 'last4' | 'expMonth' | 'expYear'>,
): boolean {
  return cards.some(
    (card) =>
      card.brand === candidate.brand &&
      card.last4 === candidate.last4 &&
      card.expMonth === candidate.expMonth &&
      card.expYear % 100 === candidate.expYear % 100,
  );
}
