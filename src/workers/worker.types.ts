import { Job, JobType } from '@prisma/client';

export type WorkerRunResult = Record<string, unknown>;

export type WorkerContext = {
  workflowRunId?: string;
  payload: Record<string, unknown>;
};

export interface JobWorker {
  readonly jobTypes: JobType[];
  run(job: Job, context: WorkerContext): Promise<WorkerRunResult>;
}
