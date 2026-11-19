import type { Tx } from './tx';

const SEQUENCES = {
  order: 'order_number_seq',
  quote: 'quote_number_seq',
  issue: 'issue_number_seq',
} as const;

/** The next human number (statement (j) of §3.5): IS-10001, Q-10001, CASE-10001. */
export async function nextNumber(tx: Tx, counter: keyof typeof SEQUENCES): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(`SELECT nextval('${SEQUENCES[counter]}') AS n`);
  return rows[0]!.n;
}
