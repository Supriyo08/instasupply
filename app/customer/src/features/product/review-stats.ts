import type { Review } from '@instasupply/shared';

export interface RatingStats {
  /** Mean rating rounded to one decimal (0 when there are no reviews). */
  average: number;
  count: number;
  /** Reviews per star: index 0 = 1 star … index 4 = 5 stars. */
  byStar: number[];
}

/** Average and star distribution of a set of reviews. */
export function ratingStats(reviews: readonly Pick<Review, 'rating'>[]): RatingStats {
  const byStar = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const review of reviews) {
    const star = Math.round(review.rating);
    if (!(star >= 1 && star <= 5)) continue;
    byStar[star - 1] = (byStar[star - 1] ?? 0) + 1;
    sum += star;
    count += 1;
  }
  return { average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0, count, byStar };
}
