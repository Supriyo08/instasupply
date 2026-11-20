import { Link } from 'react-router';

import { EmptyState } from '@/components/ui/Feedback';
import { PinIcon } from '@/components/ui/icons';
import { useAuth } from '@/features/auth/AuthProvider';

export default function NotFoundPage() {
  const { isSupplier } = useAuth();
  return (
    <EmptyState
      icon={PinIcon}
      title="Page not found"
      description="The page you're looking for doesn't exist or was moved."
      action={
        <Link
          to={isSupplier ? '/portal' : '/'}
          className="text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          {isSupplier ? 'Back to orders' : 'Back to dashboard'}
        </Link>
      }
    />
  );
}
