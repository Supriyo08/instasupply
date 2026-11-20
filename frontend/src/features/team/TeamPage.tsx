import { formatDateTimeET, isValidEmail, type StaffRole } from '@instasupply/shared';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Field, Segmented, TextArea, TextInput } from '@/components/ui/Form';
import {
  ApproveIcon,
  ChevronDownIcon,
  ErrorIcon,
  InviteIcon,
  KeyIcon,
  SuspendIcon,
  UsersIcon,
} from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { api, call, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useNow, useStaff, type UserRecord } from '@/lib/data';

import { SessionsPanel } from './SessionsPanel';

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('dispatcher');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setName('');
    setEmail('');
    setRole('dispatcher');
    setError(null);
    setLink(null);
    onClose();
  };

  const invite = async () => {
    if (busy) return;
    if (!name.trim()) return setError('Enter their name.');
    if (!isValidEmail(email.trim())) return setError('Enter a valid email address.');
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
      dismissOnBackdrop={false}
      title={link ? 'Share the set-up link' : 'Invite a teammate'}
      description={
        link
          ? 'Send this link to them privately. It lets them choose their own password and works once, for 72 hours.'
          : 'Dispatchers run deliveries, drivers, orders and support; admins also manage the team, approvals and payouts.'
      }
      footer={
        link ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
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
            Account created for {email.trim()}. The invite email is on its way too.
          </Callout>
          <CopyField value={link} label="Password set-up link" />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
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
          {error ? (
            <Callout tone="danger" icon={ErrorIcon}>
              {error}
            </Callout>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

/** Suspend (reason required) or restore a staff account: `PATCH /users/{uid}/status`, admin only. */
function StatusDialog({ member, onClose }: { member: UserRecord | null; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suspending = member?.status === 'active';

  const close = () => {
    if (busy) return;
    setReason('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!member || busy) return;
    if (suspending && !reason.trim()) return setError('Say why, in a few words.');
    setBusy(true);
    setError(null);
    try {
      await api.users.setStatus(member.uid, {
        status: suspending ? 'suspended' : 'active',
        reason: suspending ? reason.trim().slice(0, 200) : null,
      });
      toast.success(
        suspending ? `${member.displayName} was suspended` : `${member.displayName} was restored`,
      );
      setBusy(false);
      setReason('');
      onClose();
    } catch (caught) {
      setBusy(false);
      setError(errorMessage(caught));
    }
  };

  return (
    <Modal
      open={!!member}
      onClose={close}
      size="sm"
      title={member ? `${suspending ? 'Suspend' : 'Restore'} ${member.displayName}` : ''}
      description={
        suspending
          ? 'They are signed out of every device at once and cannot sign in until restored. Other admins are told.'
          : 'They can sign in again with their password.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant={suspending ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()}>
            {suspending ? 'Suspend' : 'Restore'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {suspending ? (
          <Field label="Reason" required hint="Kept on their account for the team.">
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        ) : member?.suspendedReason ? (
          <p className="text-sm text-slate-600">Suspended because: {member.suspendedReason}</p>
        ) : null}
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

const STATUS_BADGE = {
  active: { tone: 'success', label: 'Active' },
  pending: { tone: 'warning', label: 'Invited' },
  suspended: { tone: 'danger', label: 'Suspended' },
} as const;

export default function TeamPage() {
  const now = useNow();
  const { user } = useSignedInUser();
  const staff = useStaff();
  const [inviting, setInviting] = useState(false);
  const [statusFor, setStatusFor] = useState<UserRecord | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const activeAdmins = staff.data.filter((member) => member.role === 'admin' && member.status === 'active');
  const members = [...staff.data].sort(
    (a, b) =>
      (a.status === 'suspended' ? 1 : 0) - (b.status === 'suspended' ? 1 : 0) ||
      a.displayName.localeCompare(b.displayName),
  );

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can use the ops console. Supplier teams are managed on each store."
        actions={
          <Button icon={InviteIcon} onClick={() => setInviting(true)}>
            Invite teammate
          </Button>
        }
      />
      <Card>
        {staff.error && staff.data.length === 0 ? (
          <ErrorState error={staff.error} onRetry={staff.retry} className="m-5" />
        ) : staff.loading && staff.data.length === 0 ? (
          <PageSpinner label="Loading the team" />
        ) : staff.data.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No staff yet" description="Invite your first dispatcher." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((member) => {
              const self = member.uid === user.uid;
              const lastAdmin =
                member.role === 'admin' && member.status === 'active' && activeAdmins.length <= 1;
              const badge = STATUS_BADGE[member.status];
              const open = expanded === member.uid;
              return (
                <li key={member.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar name={member.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {member.displayName}
                        {self ? (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {member.email}
                        {member.createdAt ? ` · joined ${formatDateTimeET(member.createdAt, now)}` : ''}
                      </p>
                    </div>
                    <Badge tone={member.role === 'admin' ? 'brand' : 'neutral'}>
                      {member.role === 'admin' ? 'Admin' : 'Dispatcher'}
                    </Badge>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      trailingIcon={ChevronDownIcon}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : member.uid)}
                    >
                      Devices
                    </Button>
                    {member.status !== 'pending' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={member.status === 'active' ? SuspendIcon : ApproveIcon}
                        disabled={self || lastAdmin}
                        title={
                          self
                            ? 'You cannot change your own access.'
                            : lastAdmin
                              ? 'At least one administrator must stay active.'
                              : undefined
                        }
                        onClick={() => setStatusFor(member)}
                      >
                        {member.status === 'active' ? 'Suspend' : 'Restore'}
                      </Button>
                    ) : null}
                  </div>
                  {member.status === 'suspended' && member.suspendedReason ? (
                    <p className="mt-1 pl-12 text-xs text-rose-700">Suspended: {member.suspendedReason}</p>
                  ) : null}
                  <div className={cn('mt-3 rounded-xl bg-slate-50 p-3 pl-4', open ? 'block' : 'hidden')}>
                    {open ? <SessionsPanel uid={member.uid} name={member.displayName} self={self} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
      <StatusDialog member={statusFor} onClose={() => setStatusFor(null)} />
    </>
  );
}
