/**
 * Help & FAQ (MARKETPLACE §7.3 help row): the site's answers, paraphrased, with the numbers of the
 * pricing and timing rules (§3, §4). Grouped for the help screen.
 */
export interface FaqEntry {
  question: string;
  answer: string;
}

export const FAQ: readonly { title: string; entries: readonly FaqEntry[] }[] = [
  {
    title: 'Ordering',
    entries: [
      {
        question: 'What can I order?',
        answer:
          'Building supplies from local GTA suppliers: lumber, sheet goods, drywall, plumbing, electrical, fasteners, paint, tools and more. One search shows live stock and prices at the stores near your jobsite.',
      },
      {
        question: 'Can one order include several stores?',
        answer:
          'Yes, up to 5 stores in one checkout. Each store prepares its part separately, so you may get more than one delivery, each with its own promise and tracking.',
      },
      {
        question: "I can't find what I need.",
        answer:
          'Send us your material list: type it, paste it or upload a photo or spreadsheet. We price it with our suppliers and send you a quote, usually within 30 minutes during business hours.',
      },
    ],
  },
  {
    title: 'Delivery and pickup',
    entries: [
      {
        question: 'How much is delivery?',
        answer:
          'The fee depends on the distance and the size of the load (the vehicle it needs). Delivery is free when your items reach $500, and your first order has $0 delivery. First order of $250 or more? You also get $20 off.',
      },
      {
        question: 'When will it arrive?',
        answer:
          'Each store shows its promise, like "Delivery by 1:50 pm", before you check out. You can choose ASAP or a 2-hour window up to a week ahead. Every store order is tracked live once the truck leaves.',
      },
      {
        question: 'What is the hand-off code?',
        answer:
          'When someone on site receives the load, the driver asks for a 4-digit code shown on your order. If you choose "Leave at site", the driver takes a drop-off photo instead.',
      },
      {
        question: 'Can I get help unloading?',
        answer:
          'Add a labourer at checkout where a store offers it. For heavy loads left at an unattended site a labourer is required, and checkout says why.',
      },
      {
        question: 'How does pickup work?',
        answer:
          "Choose Pickup at checkout. When the store has packed your order you get a PIN; show it at the counter. Orders are held for a while after they're ready, and the hold time is on your order.",
      },
    ],
  },
  {
    title: 'Payments and receipts',
    entries: [
      {
        question: 'When is my card charged?',
        answer:
          "At checkout we place a hold on your card. You're charged once every store has finished your order, and only for what was supplied. The rest of the hold is released.",
      },
      {
        question: 'Which cards work?',
        answer:
          "Visa, Mastercard, American Express and Discover, credit or debit (Visa Debit and Debit Mastercard). Interac debit can't pay in the app.",
      },
      {
        question: 'Do receipts show HST?',
        answer:
          'Yes. Every order shows HST at 13 % with our registration number, which you need to claim input tax credits.',
      },
      {
        question: 'What if a store is short on stock?',
        answer:
          'The store tells us what it can supply, for example "20 of 24 — out of stock", and you are never charged for the missing units.',
      },
    ],
  },
  {
    title: 'Changes and problems',
    entries: [
      {
        question: 'Can I cancel?',
        answer:
          'You can cancel a store\'s items until that store starts preparing them. Open the order and tap "Cancel these items", or cancel the whole order.',
      },
      {
        question: 'Something arrived damaged or wrong.',
        answer:
          'Open the order and tap "Report a problem" within 48 hours. Add photos of damaged or wrong items and keep the item and its packaging until we sort it out. We offer a replacement, a refund or a return.',
      },
      {
        question: 'How do I reach support?',
        answer:
          'Use the support chat in the app (Mon–Fri 7 am–6 pm, Sat 8 am–2 pm), or call the number below.',
      },
    ],
  },
];
