import { COLLECTIONS } from '@instasupply/shared';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';

/** One review per customer per product (the document id is the customer's uid). */
export async function saveReview(input: {
  productId: string;
  uid: string;
  userName: string;
  rating: number;
  text: string;
  isUpdate: boolean;
  createdAt?: unknown;
}) {
  await setDoc(doc(db, COLLECTIONS.products, input.productId, COLLECTIONS.reviews, input.uid), {
    productId: input.productId,
    userId: input.uid,
    userName: input.userName.slice(0, 80),
    rating: Math.max(1, Math.min(5, Math.round(input.rating))),
    text: input.text.trim().slice(0, 1000),
    createdAt: input.isUpdate ? input.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
