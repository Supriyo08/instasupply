import { formatDate, isValidEmail, type StaffRole } from '@instasupply/shared';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Field, Segmented, TextInput } from '@/components/ui/Form';
import { CopyIcon, InviteIcon, KeyIcon, UsersIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { useStaff } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('dispatcher');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const close = () => {
    setName('');
    setEmail('');
    setRole('dispatcher');
    setError(null);
    setLink(null);
    onClose();
  };

  const invite = async () => {
    if (!name.trim()) return setError('Enter their name.');
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    setError(null);
    setBusy(true);
    try {
      const result = await call('createStaffUser', { email: email.trim(), displayName: name.trim(), role });
      setLink(result.passwordSetupLink);
      toast.success(`${name.trim()} was added to the team`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={link ? 'Share the setup link' : 'Invite a teammate'}
      description={
        link
          ? 'Send this link to them privately. It lets them choose their own password.'
          : 'Dispatchers manage deliveries and drivers; admins can also manage the team.'
      }
      footer={
        link ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} icon={InviteIcon} onClick={() => void invite()}>
              Create account
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="space-y-3">
          <Callout tone="success" icon={KeyIcon}>
            Account created for {email.trim()}.
          </Callout>
          <div className="rounded-lg bg-slate-50 p-3 font-mono text-[11px] break-all text-slate-600 ring-1 ring-slate-200">
            {link}
          </div>
          <Button
            variant="secondary"
            icon={CopyIcon}
            onClick={() =>
              void navigator.clipboard.writeText(link).then(
                () => toast.success('Link copied'),
                () => toast.error("Couldn't copy the link"),
              )
            }
          >
            Copy link
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Name" required>
            {(id) => (
              <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            )}
          </Field>
          <Field label="Work email" required>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">Role</p>
            <Segmented
              ariaLabel="Role"
              value={role}
              onChange={setRole}
              options={[
                { value: 'dispatcher', label: 'Dispatcher' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}

export default function TeamPage() {
  const { user } = useSignedInUser();
  const staff = useStaff();
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can use the dispatch console."
        actions={
          <Button icon={InviteIcon} onClick={() => setInviting(true)}>
            Invite teammate
          </Button>
        }
      />
      <Card>
        {staff.error ? (
          <ErrorState error={staff.error} className="m-5" />
        ) : staff.loading && staff.data.length === 0 ? (
          <PageSpinner />
        ) : staff.data.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No staff yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...staff.data]
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
              .map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={member.displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {member.displayName}
                      {member.id === user.uid ? (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-slate-500">{member.email}</p>
                  </div>
                  <span className="hidden text-xs text-slate-400 sm:block">
                    Joined {formatDate(member.createdAt)}
                  </span>
                  <Badge tone={member.role === 'admin' ? 'brand' : 'neutral'}>
                    {member.role === 'admin' ? 'Admin' : 'Dispatcher'}
                  </Badge>
                </li>
              ))}
          </ul>
        )}
      </Card>
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}
