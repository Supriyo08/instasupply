import { COLLECTIONS } from '@instasupply/shared';
import { AggregateField } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { db } from '../../lib/admin';
import { baseOptions } from '../../lib/functions';

/** Keeps each product's average rating and review count current. */
export const onReviewWritten = onDocumentWritten(
  { ...baseOptions, document: `${COLLECTIONS.products}/{productId}/${COLLECTIONS.reviews}/{userId}` },
  async (event) => {
    const productRef = db.collection(COLLECTIONS.products).doc(event.params.productId);
    const summary = await productRef
      .collection(COLLECTIONS.reviews)
      .aggregate({ count: AggregateField.count(), average: AggregateField.average('rating') })
      .get();
    const { count, average } = summary.data();
    try {
      await productRef.update({
        rating: average ? Math.round(average * 10) / 10 : 0,
        ratingCount: count,
      });
    } catch (error) {
      logger.warn('Could not update product rating', {
        productId: event.params.productId,
        error: error instanceof Error ? error.message : error,
      });
    }
  },
);
