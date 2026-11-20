import { useApi, useApiMutation, useApiQuery } from '@instasupply/api-client/react';
import { isValidEmail, type UserProfile } from '@instasupply/shared';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyField } from '@/components/ui/CopyField';
import { QueryView } from '@/components/ui/Data';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextArea, TextInput } from '@/components/ui/Form';
import { ApproveIcon, ErrorIcon, InviteIcon, SuspendIcon, UsersIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSupplier } from '@/features/auth/AuthProvider';
import { describeError, queries } from '@/lib/api';

function InviteDialog({ open, onClose, storeId }: { open: boolean; onClose: () => void; storeId: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const invite = useApiMutation((api, input: { displayName: string; email: string }) =>
    api.call('inviteSupplierUser', { storeId, storeRole: 'staff', ...input }),
  );
  const nameError = touched && name.trim().length < 2 ? 'Enter their name.' : null;
  const emailError = touched && !isValidEmail(email.trim()) ? 'Enter a valid email address.' : null;

  const submit = async () => {
    setTouched(true);
    if (name.trim().length < 2 || !isValidEmail(email.trim())) return;
    setError(null);
    try {
      const result = await invite.run({ displayName: name.trim(), email: email.trim().toLowerCase() });
      setLink(result.passwordSetupLink);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!invite.busy) onClose();
      }}
      dismissOnBackdrop={false}
      size="sm"
      title={link ? 'Invitation ready' : 'Invite a team member'}
      description={
        link
          ? 'We emailed them a link to set a password. You can also send this link yourself; it works once and expires in 72 hours.'
          : 'Staff can work orders, the catalogue, the store profile and support. Only owners see payouts, insights and the team.'
      }
      footer={
        link ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={invite.busy}>
              Cancel
            </Button>
            <Button icon={InviteIcon} loading={invite.busy} onClick={() => void submit()}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {link ? (
        <CopyField value={link} label="Password set-up link" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" required error={nameError}>
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                autoComplete="off"
                value={name}
                invalid={!!nameError}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Work email" required error={emailError}>
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="email"
                aria-describedby={describedBy}
                autoComplete="off"
                value={email}
                invalid={!!emailError}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <Callout tone="danger" icon={ErrorIcon}>
              {error}
            </Callout>
          ) : null}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}

function statusBadge(status: UserProfile['status']) {
  if (status === 'active') return <Badge tone="success">Active</Badge>;
  if (status === 'suspended') return <Badge tone="danger">Suspended</Badge>;
  return <Badge tone="warning">Invited</Badge>;
}

/**
 * `/portal/team` (owner; MARKETPLACE §8, CLIENTS §4.4): the store's members with role and status,
 * "Invite staff" (shows the returned set-up link) and suspend or restore. An owner cannot suspend
 * themselves.
 */
export default function PortalTeamPage() {
  const { storeId, user } = useSupplier();
  const client = useApi();
  const toast = useToast();
  const team = useApiQuery(queries.storeTeam(storeId));
  const [inviteSession, setInviteSession] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [target, setTarget] = useState<UserProfile | null>(null);
  const [reason, setReason] = useState('');

  const suspending = target?.status !== 'suspended';

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in to your store's portal."
        actions={
          <Button
            icon={InviteIcon}
            onClick={() => {
              setInviteSession((value) => value + 1);
              setInviteOpen(true);
            }}
          >
            Invite staff
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <QueryView
          query={team}
          loadingLabel="Loading your team"
          empty={{
            icon: UsersIcon,
            title: 'Nobody here yet',
            description: 'Invite the people who work your counter.',
          }}
        >
          {(members) => (
            <ul className="divide-y divide-slate-100">
              {[...members]
                .sort(
                  (a, b) =>
                    Number(b.storeRole === 'owner') - Number(a.storeRole === 'owner') ||
                    a.displayName.localeCompare(b.displayName),
                )
                .map((member) => {
                  const self = member.uid === user.uid;
                  return (
                    <li key={member.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <Avatar name={member.displayName} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {member.displayName}
                          {self ? (
                            <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {member.email ?? 'No email on file'}
                        </p>
                        {member.status === 'suspended' && member.suspendedReason ? (
                          <p className="text-xs text-rose-700">Suspended: {member.suspendedReason}</p>
                        ) : null}
                      </div>
                      <Badge tone={member.storeRole === 'owner' ? 'brand' : 'neutral'}>
                        {member.storeRole === 'owner' ? 'Owner' : 'Staff'}
                      </Badge>
                      {statusBadge(member.status)}
                      {!self && member.storeRole !== 'owner' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={member.status === 'suspended' ? ApproveIcon : SuspendIcon}
                          aria-label={`${member.status === 'suspended' ? 'Restore' : 'Suspend'} ${member.displayName}`}
                          onClick={() => {
                            setReason('');
                            setTarget(member);
                          }}
                        >
                          {member.status === 'suspended' ? 'Restore' : 'Suspend'}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          )}
        </QueryView>
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        To add another owner or change who owns the store, message InstaSupply from Support.
      </p>

      <InviteDialog
        key={inviteSession}
        open={inviteOpen}
        storeId={storeId}
        onClose={() => {
          setInviteOpen(false);
          void client.cache.invalidate(['users', 'store', storeId]);
        }}
      />
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={suspending ? `Suspend ${target?.displayName ?? ''}?` : `Restore ${target?.displayName ?? ''}?`}
        description={
          suspending
            ? 'They are signed out at once and cannot sign in until you restore them.'
            : 'They can sign in again with their existing password.'
        }
        confirmLabel={suspending ? 'Suspend' : 'Restore'}
        tone={suspending ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (!target) return;
          await client.call('setSupplierUserStatus', {
            uid: target.uid,
            status: suspending ? 'suspended' : 'active',
            reason: suspending ? reason.trim() || null : null,
          });
          await client.cache.invalidate(['users', 'store', storeId]);
          toast.success(
            suspending ? `${target.displayName} is suspended` : `${target.displayName} can sign in again`,
          );
        }}
      >
        {suspending ? (
          <Field label="Reason (optional)" hint="Kept on their account for you and InstaSupply.">
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
