/**
 * `/issues` (MARKETPLACE §9, CLIENTS §4.5): the problem-report queue with the SLA (staff aim to
 * resolve each case within 4 hours), newest first and paged. "Assign to me" picks a case up
 * (open → in review, `api.issues.update`).
 */
import { usePagedQuery } from '@instasupply/api-client/react';
import { ISSUE_SLA_HOURS, formatRelativeTime, type Issue, type IssueStatus } from '@instasupply/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Countdown } from '@/components/ui/Countdown';
import { LoadMore } from '@/components/ui/Data';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { ChevronRightIcon, UserIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { ArtEmptyState } from '@/features/orders/components/ItemThumb';
import { api, describeError, queries } from '@/lib/api';
import { useNow, useOpsDashboard } from '@/lib/data';

import { ISSUE_STATUS_META, ISSUE_TYPE_LABELS, PREFERRED_LABELS } from './issue-format';

type Tab = 'active' | IssueStatus | 'all';

const FILTERS: Record<Tab, Record<string, string[]>> = {
  active: { status: ['open', 'in_review'] },
  open: { status: ['open'] },
  in_review: { status: ['in_review'] },
  resolved: { status: ['resolved'] },
  all: {},
};

export function AssignToMe({ issue }: { issue: Pick<Issue, 'id' | 'status' | 'assignedTo'> }) {
  const { user } = useSignedInUser();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (issue.status === 'resolved' || issue.assignedTo === user.uid) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={UserIcon}
      loading={busy}
      onClick={() => {
        setBusy(true);
        api.issues
          .update(issue.id, { assignedTo: user.uid, status: 'in_review' })
          .catch((error: unknown) => toast.error("Couldn't assign the case", describeError(error)))
          .finally(() => setBusy(false));
      }}
    >
      Assign to me
    </Button>
  );
}

export function IssueSla({ issue }: { issue: Pick<Issue, 'status' | 'slaDueAt' | 'statusAt'> }) {
  if (issue.status === 'resolved') {
    return <span className="text-xs text-slate-500">Resolved</span>;
  }
  return (
    <Countdown
      deadline={issue.slaDueAt}
      prefix="Due in"
      overdueLabel="Past SLA by"
      warnMs={60 * 60_000}
      urgentMs={30 * 60_000}
    />
  );
}

function IssueRow({ issue, now }: { issue: Issue; now: number }) {
  const status = ISSUE_STATUS_META[issue.status];
  return (
    <tr className="transition-colors hover:bg-slate-50">
      <td className="px-5 py-3 align-top">
        <Link
          to={`/issues/${encodeURIComponent(issue.id)}`}
          className="font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
        >
          {issue.number}
        </Link>
        <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(issue.createdAt, now)}</p>
      </td>
      <td className="max-w-64 px-3 py-3 align-top">
        <p className="font-medium text-slate-900">{ISSUE_TYPE_LABELS[issue.type]}</p>
        <p className="truncate text-xs text-slate-500">{issue.description}</p>
      </td>
      <td className="hidden max-w-56 px-3 py-3 align-top md:table-cell">
        <p className="truncate text-slate-900">{issue.customerName}</p>
        <p className="truncate text-xs text-slate-500">
          {issue.storeName} · {issue.storeOrderNumber}
        </p>
      </td>
      <td className="hidden px-3 py-3 align-top text-xs text-slate-600 lg:table-cell">
        {PREFERRED_LABELS[issue.preferredResolution]}
      </td>
      <td className="px-3 py-3 align-top">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        <p className="mt-1 text-xs">
          <IssueSla issue={issue} />
        </p>
        {issue.assignedName ? <p className="mt-1 text-xs text-slate-500">{issue.assignedName}</p> : null}
      </td>
      <td className="px-3 py-3 align-top">
        <AssignToMe issue={issue} />
      </td>
      <td className="py-3 pr-5 align-top text-slate-300">
        <ChevronRightIcon size={16} aria-hidden />
      </td>
    </tr>
  );
}

export default function IssuesPage() {
  const now = useNow();
  const [tab, setTab] = useState<Tab>('active');
  const issues = usePagedQuery(queries.opsIssues(FILTERS[tab]));
  const dashboard = useOpsDashboard().data;

  return (
    <>
      <PageHeader
        title="Issues"
        description={`Damaged, wrong, missing or short items and late deliveries. Resolve each case within ${ISSUE_SLA_HOURS} hours.`}
      />
      <Tabs<Tab>
        ariaLabel="Issue status"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'active', label: 'To do', count: dashboard?.issues.open },
          { value: 'open', label: 'Open' },
          { value: 'in_review', label: 'In review' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'all', label: 'All' },
        ]}
      />
      {dashboard && dashboard.issues.pastSla > 0 && tab !== 'resolved' ? (
        <p className="mt-3 text-sm font-medium text-rose-700">
          {dashboard.issues.pastSla} {dashboard.issues.pastSla === 1 ? 'case is' : 'cases are'} past the SLA.
        </p>
      ) : null}
      <Card className="mt-4 overflow-hidden" role="tabpanel">
        {issues.loading && issues.items.length === 0 ? (
          <PageSpinner label="Loading issues" />
        ) : issues.error && issues.items.length === 0 ? (
          <ErrorState error={issues.error} onRetry={issues.retry} className="m-5" />
        ) : issues.items.length === 0 ? (
          <ArtEmptyState
            artKey="scene-report-issue"
            title={tab === 'active' ? 'No open cases' : 'Nothing here'}
            description="Customers report problems from a completed order in the app."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Issues, newest first</caption>
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Case
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Problem
                    </th>
                    <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">
                      Customer and store
                    </th>
                    <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
                      Asked for
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Status and SLA
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      <span className="sr-only">Assign</span>
                    </th>
                    <th scope="col" className="w-10 py-3 pr-5">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {issues.items.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} now={now} />
                  ))}
                </tbody>
              </table>
            </div>
            <LoadMore
              hasMore={issues.hasMore}
              loadingMore={issues.loadingMore}
              onLoadMore={issues.loadMore}
            />
          </>
        )}
      </Card>
    </>
  );
}
