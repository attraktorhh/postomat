import { PgBoss } from 'pg-boss';
import type { Logger } from '@postomat/core';

/** Job names and payloads. */
export interface JobPayloads {
  'banner.render': { postId: number };
  'publish.channel': { postId: number; channel: 'wordpress' | 'wiki' };
  'publish.update': { postId: number; channel: 'wordpress' | 'wiki' };
  'meetup.poll': Record<string, never>;
  /** Re-enqueues auto channels whose publish job got lost (crash, queue error). */
  'publish.sweep': Record<string, never>;
  /** Deletes old processed Matrix events and expired web sessions. */
  'maintenance.cleanup': Record<string, never>;
  'bot.card': { postId: number };
  'bot.dm': { matrixUserId: string; text: string; html?: string };
  'bot.after-publish': { postId: number };
  'bot.thread': { postId: number; text: string };
}
export type JobName = keyof JobPayloads;

export interface JobMeta {
  attempt: number;
  isLastAttempt: boolean;
}

export type JobHandler<N extends JobName> = (
  data: JobPayloads[N],
  meta: JobMeta,
) => Promise<void>;

export interface SendOptions {
  singletonKey?: string;
  singletonSeconds?: number;
}

export interface JobQueue {
  /**
   * `singletonKey` alone is NOT a de-duplication guarantee with the
   * `standard` queue policy. Together with `singletonSeconds` pg-boss
   * throttles: at most one job per key in each time slot. Handlers must be
   * idempotent either way.
   */
  send<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    opts?: SendOptions,
  ): Promise<void>;
  work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void>;
  schedule(name: JobName, cron: string): Promise<void>;
  stop(): Promise<void>;
}

/** Every job type; the `satisfies` makes a new job in JobPayloads a compile error here. */
const QUEUES = {
  'banner.render': true,
  'publish.channel': true,
  'publish.update': true,
  'publish.sweep': true,
  'meetup.poll': true,
  'maintenance.cleanup': true,
  'bot.card': true,
  'bot.dm': true,
  'bot.after-publish': true,
  'bot.thread': true,
} as const satisfies Record<JobName, true>;

export const ALL_QUEUES = Object.keys(QUEUES) as JobName[];

/** pg-boss backed queue (production). */
export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss;
  private readonly retryLimit: number;
  private readonly log: Logger;
  private started = false;

  /**
   * `maintenance: false` for processes that only send and work jobs (bot, web):
   * then only one process (the worker) runs pg-boss housekeeping and cron.
   */
  constructor(
    connectionString: string,
    opts: { retryLimit: number; logger: Logger; maintenance?: boolean },
  ) {
    const maintenance = opts.maintenance ?? true;
    this.boss = new PgBoss({
      connectionString,
      supervise: maintenance,
      schedule: maintenance,
    });
    this.retryLimit = opts.retryLimit;
    this.log = opts.logger;
    this.boss.on('error', (e: Error) =>
      this.log.error('pg-boss error', { error: e.message }),
    );
  }

  async start(): Promise<this> {
    if (this.started) return this;
    await this.boss.start();
    for (const q of ALL_QUEUES) {
      await this.boss.createQueue(q, {
        retryLimit: this.retryLimit,
        retryDelay: 10,
        retryBackoff: true,
      });
    }
    this.started = true;
    return this;
  }

  /**
   * Queues use the `standard` policy, so the same job may be queued twice.
   * Handlers must be idempotent (publishing claims the channel atomically).
   */
  async send<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    opts: SendOptions = {},
  ): Promise<void> {
    await this.boss.send(name, data as object, {
      retryLimit: this.retryLimit,
      retryDelay: 10,
      retryBackoff: true,
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts.singletonSeconds
        ? { singletonSeconds: opts.singletonSeconds }
        : {}),
    });
  }

  async work<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
  ): Promise<void> {
    await this.boss.work(
      name,
      { includeMetadata: true, pollingIntervalSeconds: 2 },
      async (jobs) => {
        for (const job of jobs) {
          const retryCount = (job as { retryCount?: number }).retryCount ?? 0;
          const retryLimit =
            (job as { retryLimit?: number }).retryLimit ?? this.retryLimit;
          await handler(job.data as JobPayloads[N], {
            attempt: retryCount + 1,
            isLastAttempt: retryCount >= retryLimit,
          });
        }
      },
    );
  }

  async schedule(name: JobName, cron: string): Promise<void> {
    await this.boss.schedule(name, cron, {}, { tz: 'Europe/Berlin' });
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10000 });
  }
}

/**
 * In-memory queue for tests and the e2e flow: jobs run when `drain()` is
 * called, with the same retry semantics as pg-boss.
 */
export class InMemoryQueue implements JobQueue {
  readonly handlers = new Map<JobName, JobHandler<JobName>>();
  readonly pending: Array<{
    name: JobName;
    data: unknown;
    attempt: number;
  }> = [];
  readonly sent: Array<{ name: JobName; data: unknown }> = [];
  readonly failures: Array<{ name: JobName; error: string }> = [];
  readonly retryLimit: number;
  constructor(retryLimit = 2) {
    this.retryLimit = retryLimit;
  }

  /** Like pg-boss with the `standard` policy: no de-duplication. */
  async send<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    _opts?: SendOptions,
  ): Promise<void> {
    this.sent.push({ name, data });
    this.pending.push({ name, data, attempt: 1 });
  }

  async work<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
  ): Promise<void> {
    this.handlers.set(name, handler as unknown as JobHandler<JobName>);
  }

  async schedule(): Promise<void> {
    /* tests trigger scheduled jobs explicitly */
  }

  /** Runs pending jobs (and jobs they enqueue) until none are left. */
  async drain(
    filter?: (name: JobName) => boolean,
    maxJobs = 500,
  ): Promise<void> {
    let n = 0;
    for (;;) {
      const idx = this.pending.findIndex(
        (j) => (!filter || filter(j.name)) && this.handlers.has(j.name),
      );
      if (idx < 0) return;
      if (++n > maxJobs) throw new Error('InMemoryQueue.drain: too many jobs');
      const job = this.pending.splice(idx, 1)[0];
      const handler = this.handlers.get(job.name)!;
      try {
        await handler(job.data as never, {
          attempt: job.attempt,
          isLastAttempt: job.attempt > this.retryLimit,
        });
      } catch (e) {
        this.failures.push({
          name: job.name,
          error: e instanceof Error ? e.message : String(e),
        });
        if (job.attempt <= this.retryLimit)
          this.pending.push({ ...job, attempt: job.attempt + 1 });
      }
    }
  }

  async stop(): Promise<void> {
    /* nothing */
  }
}
