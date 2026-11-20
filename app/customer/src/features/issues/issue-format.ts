import type { Issue, IssueStatus, IssueType } from '@instasupply/shared';

import type { StatusTone } from '@/theme/tokens';

export const ISSUE_TYPES: readonly { value: IssueType; label: string }[] = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'missing_item', label: 'Missing item' },
  { value: 'short_quantity', label: 'Short quantity' },
  { value: 'late', label: 'Late delivery' },
  { value: 'other', label: 'Something else' },
];

export const RESOLUTIONS: readonly { value: Issue['preferredResolution']; label: string }[] = [
  { value: 'replacement', label: 'Replacement' },
  { value: 'refund', label: 'Refund' },
  { value: 'return', label: 'Return' },
];

export const ISSUE_STATUS: Record<IssueStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'Open', tone: 'warning' },
  in_review: { label: 'Being reviewed', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export const issueTypeLabel = (type: IssueType) =>
  ISSUE_TYPES.find((entry) => entry.value === type)?.label ?? 'Problem';

export const resolutionLabel = (value: Issue['preferredResolution']) =>
  RESOLUTIONS.find((entry) => entry.value === value)?.label ?? value;

/** Photos are required for these: staff can't judge a damaged or wrong item without one (§5.5.7). */
export const needsPhoto = (type: IssueType | null) => type === 'damaged' || type === 'wrong_item';

export const MAX_ISSUE_PHOTOS = 6;
