import { IntroCarousel } from '@/features/session/components/IntroCarousel';
import { useSession } from '@/features/session/SessionProvider';

/** Onboarding slides. Finishing marks them as seen; the router then moves on to /welcome. */
export default function IntroScreen() {
  const { finishOnboarding } = useSession();
  return <IntroCarousel onFinish={finishOnboarding} />;
}
