import { seg } from './context';

/** The job board (PLATFORM §5.3.5). Claiming is the `claimJob` command. */
export const jobPaths = {
  offers: '/job-offers',
  offer: (deliveryId: string) => `/job-offers/${seg(deliveryId)}`,
} as const;
