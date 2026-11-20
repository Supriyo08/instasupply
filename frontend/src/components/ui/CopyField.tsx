import { useState } from 'react';

import { Button } from './Button';
import { CheckIcon, CopyIcon } from './icons';

/**
 * A read-only value with a Copy button: set-password links of `createStaffUser` and
 * `inviteSupplierUser`, tracking links. The value is selectable when the clipboard is blocked.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        className="h-9 min-w-0 flex-1 rounded-lg bg-slate-50 px-3 font-mono text-xs text-slate-700 ring-1 ring-slate-200 ring-inset"
      />
      <Button variant="secondary" icon={copied ? CheckIcon : CopyIcon} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
