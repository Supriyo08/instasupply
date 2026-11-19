import { Link } from 'react-router';

import { EmptyState } from '@/components/ui/Feedback';
import { PinIcon } from '@/components/ui/icons';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={PinIcon}
      title="Page not found"
      description="The page you're looking for doesn't exist or was moved."
      action={
        <Link to="/" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Back to dashboard
        </Link>
      }
    />
  );
}
