import type { Job, SubmissionSideEffectPayload } from './job.types.js';

export interface IJobHandler {
  handle(job: Job): Promise<void>;
}

export type HandlerMode = 'success' | 'transient_failure' | 'permanent_failure';

export class SubmissionSideEffectHandler implements IJobHandler {
  private mode: HandlerMode = 'success';
  private failureCountRemaining = 0;
  private executionCount = 0;
  private customHook?: (job: Job) => Promise<void> | void;

  /**
   * Configure handler mode for tests.
   */
  setMode(mode: HandlerMode, failTimes = 0): void {
    this.mode = mode;
    this.failureCountRemaining = failTimes;
  }

  setCustomHook(hook?: (job: Job) => Promise<void> | void): void {
    this.customHook = hook;
  }

  getExecutionCount(): number {
    return this.executionCount;
  }

  reset(): void {
    this.mode = 'success';
    this.failureCountRemaining = 0;
    this.executionCount = 0;
    this.customHook = undefined;
  }

  async handle(job: Job): Promise<void> {
    this.executionCount++;

    const payload = job.payload as unknown as SubmissionSideEffectPayload;

    if (!payload.submissionId || !payload.widgetId) {
      throw new Error('Invalid job payload: missing submissionId or widgetId');
    }

    if (this.customHook) {
      await this.customHook(job);
      return;
    }

    if (this.mode === 'permanent_failure') {
      throw new Error('Deterministic permanent side effect failure');
    }

    if (this.mode === 'transient_failure') {
      if (this.failureCountRemaining > 0) {
        this.failureCountRemaining--;
        throw new Error('Deterministic transient side effect failure');
      }
      // If countdown reached 0, proceed to success
    }

    // Default success side-effect: internal event processed cleanly
  }
}

export class JobHandlerRegistry {
  private handlers: Map<string, IJobHandler> = new Map();

  register(jobType: string, handler: IJobHandler): void {
    this.handlers.set(jobType, handler);
  }

  get(jobType: string): IJobHandler | undefined {
    return this.handlers.get(jobType);
  }

  has(jobType: string): boolean {
    return this.handlers.has(jobType);
  }
}

export const submissionSideEffectHandler = new SubmissionSideEffectHandler();

export const jobHandlerRegistry = new JobHandlerRegistry();
jobHandlerRegistry.register('submission.side_effect', submissionSideEffectHandler);
