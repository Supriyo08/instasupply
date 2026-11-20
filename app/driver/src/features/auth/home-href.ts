import type { SessionStatus } from './SessionProvider';

/** Where each session state belongs; used as the redirect target of the protected route groups. */
export function homeHref(status: SessionStatus) {
  switch (status) {
    case 'signed_out':
      return '/sign-in' as const;
    case 'needs_profile':
      return '/onboarding/profile' as const;
    case 'needs_phone':
      return '/onboarding/verify-phone' as const;
    case 'pending_approval':
      return '/onboarding/pending' as const;
    case 'suspended':
    case 'staff_account':
    case 'shopper_account':
    case 'supplier_account':
      return '/onboarding/account' as const;
    default:
      return '/' as const;
  }
}
