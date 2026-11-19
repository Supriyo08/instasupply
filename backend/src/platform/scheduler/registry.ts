/** Scheduled jobs by name (docs/PLATFORM.md §9.5). Modules register theirs in `register(app, deps)`. */
import type { ScheduledJobName } from '@instasupply/shared';
import type { Deps } from '../../container';

export type JobSchedule = { everyMs: number } | { dailyAt: { hour: number; minute: number } };
export type JobResult = Record<string, number>;

export interface JobSpec {
  /** A ScheduledJobName, or an internal job (purgeExpiredRows, checkPushReceipts) that runJobNow cannot run. */
  name: ScheduledJobName | InternalJobName;
  schedule: JobSchedule;
  /** The body: `runX(deps, now)`. Each candidate row is handled in its own transaction. */
  run: (deps: Deps, now: number) => Promise<JobResult>;
}

export type InternalJobName = 'purgeExpiredRows' | 'checkPushReceipts';

const jobs = new Map<string, JobSpec>();

/** Process-wide, like the command and handler registries: a later registration of a name replaces it. */
export function registerJob(spec: JobSpec): void {
  jobs.set(spec.name, spec);
}

export const jobFor = (name: string): JobSpec | undefined => jobs.get(name);
export const registeredJobs = (): JobSpec[] =>
  [...jobs.values()].sort((a, b) => a.name.localeCompare(b.name));

export function describeSchedule(schedule: JobSchedule): string {
  if ('everyMs' in schedule) {
    const minutes = schedule.everyMs / 60_000;
    return minutes >= 60 && minutes % 60 === 0 ? `every ${minutes / 60} h` : `every ${minutes} min`;
  }
  const hh = String(schedule.dailyAt.hour).padStart(2, '0');
  const mm = String(schedule.dailyAt.minute).padStart(2, '0');
  return `daily ${hh}:${mm} America/Toronto`;
}
