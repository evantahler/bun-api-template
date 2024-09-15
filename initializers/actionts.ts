import type { ErrorPayload } from "node-resque";
import { logger, api } from "../api";
import { DEFAULT_QUEUE, type Action } from "../classes/Action";
import { Initializer } from "../classes/Initializer";
import { ErrorType, TypedError } from "../classes/TypedError";
import { globLoader } from "../util/glob";

const namespace = "actions";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Actions["initialize"]>>;
  }
}

export type TaskInputs = Record<string, any>;

export class Actions extends Initializer {
  constructor() {
    super(namespace);
    this.loadPriority = 100;
  }

  /**
   * Enqueue an action to be performed in the background.
   * Will throw an error if redis cannot be reached.
   */
  enqueue = async (
    actionName: string,
    inputs: TaskInputs = {},
    queue: string = DEFAULT_QUEUE,
  ) => {
    const action = api.actions.actions.find((a) => a.name === actionName);
    if (!action) {
      throw new TypedError({
        message: `action ${actionName} not found`,
        type: ErrorType.CONNECTION_TASK_DEFINITION,
      });
    }
    queue = action?.task?.queue ?? DEFAULT_QUEUE;
    return api.resque.queue.enqueue(queue, actionName, [inputs]);
  };

  /**
   * Enqueue a task to be performed in the background, at a certain time in the future.
   * Will throw an error if redis cannot be reached.
   *
   * Inputs:
   * * actionName: The name of the task.
   * * inputs: inputs to pass to the task.
   * * queue: (Optional) Which queue/priority to run this instance of the task on.
   * * suppressDuplicateTaskError: (optional) Suppress errors when the same task with the same arguments are double-enqueued for the same time
   */
  enqueueAt = async (
    timestamp: number,
    actionName: string,
    inputs: TaskInputs = {},
    queue: string = DEFAULT_QUEUE,
    suppressDuplicateTaskError = false,
  ) => {
    return api.resque.queue.enqueueAt(
      timestamp,
      queue,
      actionName,
      [inputs],
      suppressDuplicateTaskError,
    );
  };

  /**
   * Enqueue a task to be performed in the background, at a certain number of ms from now.
   * Will throw an error if redis cannot be reached.
   *
   * Inputs:
   * * timestamp: At what time the task is able to be run.  Does not guarantee that the task will be run at this time. (in ms)
   * * actionName: The name of the task.
   * * inputs: inputs to pass to the task.
   * * queue: (Optional) Which queue/priority to run this instance of the task on.
   * * suppressDuplicateTaskError: (optional) Suppress errors when the same task with the same arguments are double-enqueued for the same time
   */
  enqueueIn = async (
    time: number,
    actionName: string,
    inputs: TaskInputs = {},
    queue: string = DEFAULT_QUEUE,
    suppressDuplicateTaskError = false,
  ) => {
    return api.resque.queue.enqueueIn(
      time,
      queue,
      actionName,
      [inputs],
      suppressDuplicateTaskError,
    );
  };

  /**
   * Delete a previously enqueued task, which hasn't been run yet, from a queue.
   * Will throw an error if redis cannot be reached.
   *
   * Inputs:
   * * q: Which queue/priority is the task stored on?
   * * actionName: The name of the job, likely to be the same name as a tak.
   * * args: The arguments of the job.  Note, arguments passed to a Task initially may be modified when enqueuing.  It is best to read job properties first via `api.tasks.queued` or similar method.
   * * count: Of the jobs that match q, actionName, and args, up to what position should we delete? (Default 0; this command is 0-indexed)
   */
  del = async (
    queue: string,
    actionName: string,
    args?: TaskInputs,
    count?: number,
  ) => {
    return api.resque.queue.del(queue, actionName, [args], count);
  };

  /**
   * * will delete all jobs in the given queue of the named function/class
   * * will not prevent new jobs from being added as this method is running
   * * will not delete jobs in the delayed queues
   *
   * Inputs:
   * * q: Which queue/priority is to run on?
   * * actionName: The name of the job, likely to be the same name as a tak.
   * * start? - starting position of task count to remove
   * * stop? - stop position of task count to remove
   */
  delByFunction = async (
    queue: string,
    actionName: string,
    start?: number,
    stop?: number,
  ) => {
    return api.resque.queue.delByFunction(queue, actionName, start, stop);
  };

  /**
   * Delete all previously enqueued tasks, which haven't been run yet, from all possible delayed timestamps.
   * Will throw an error if redis cannot be reached.
   *
   * Inputs:
   * * q: Which queue/priority is to run on?
   * * actionName: The name of the job, likely to be the same name as a tak.
   * * inputs  The arguments of the job.  Note, arguments passed to a Task initially may be modified when enqueuing. It is best to read job properties first via `api.tasks.delayedAt` or similar method.
   */
  delDelayed = async (
    queue: string,
    actionName: string,
    inputs?: TaskInputs,
  ) => {
    return api.resque.queue.delDelayed(queue, actionName, [inputs]);
  };

  /**
   * Return the timestamps a task is scheduled for.
   * Will throw an error if redis cannot be reached.
   *
   * Inputs:
   * * q: Which queue/priority is to run on?
   * * actionName: The name of the job, likely to be the same name as a tak.
   * * inputs: The arguments of the job.  Note, arguments passed to a Task initially may be modified when enqueuing.  It is best to read job properties first via `api.tasks.delayedAt` or similar method.
   */
  scheduledAt = async (
    queue: string,
    actionName: string,
    inputs: TaskInputs,
  ): Promise<Array<number>> => {
    return api.resque.queue.scheduledAt(queue, actionName, [inputs]);
  };

  /**
   * Return all resque stats for this namespace (how jobs failed, jobs succeeded, etc)
   * Will throw an error if redis cannot be reached.
   */
  resqueStats = async () => {
    return api.resque.queue.stats();
  };

  /**
   * Retrieve the details of jobs enqueued on a certain queue between start and stop (0-indexed)
   * Will throw an error if redis cannot be reached.
   *
   * Inputs:
   * * q      The name of the queue.
   * * start  The index of the first job to return.
   * * stop   The index of the last job to return.
   */
  queued = (
    queue: string,
    start: number,
    stop: number,
  ): Promise<Array<TaskInputs>> => {
    return api.resque.queue.queued(queue, start, stop);
  };

  /**
   * Delete a queue in redis, and all jobs stored on it.
   * Will throw an error if redis cannot be reached.
   */
  delQueue = async (q: string) => {
    return api.resque.queue.delQueue(q);
  };

  /**
   * Return any locks, as created by resque plugins or task middleware, in this redis namespace.
   * Will contain locks with keys like `resque:lock:{job}` and `resque:workerslock:{workerId}`
   * Will throw an error if redis cannot be reached.
   */
  locks = async () => {
    return api.resque.queue.locks();
  };

  /**
   * Delete a lock on a job or worker.  Locks can be found via `api.tasks.locks`
   * Will throw an error if redis cannot be reached.
   */
  delLock = async (lock: string) => {
    return api.resque.queue.delLock(lock);
  };

  /**
   * List all timestamps for which tasks are enqueued in the future, via `api.tasks.enqueueIn` or `api.tasks.enqueueAt`
   * Will throw an error if redis cannot be reached.
   */
  timestamps = async (): Promise<Array<number>> => {
    return api.resque.queue.timestamps();
  };

  /**
   * Return all jobs which have been enqueued to run at a certain timestamp.
   * Will throw an error if redis cannot be reached.
   */
  delayedAt = async (timestamp: number): Promise<any> => {
    return api.resque.queue.delayedAt(timestamp);
  };

  /**
   * Return all delayed jobs, organized by the timestamp at where they are to run at.
   * Note: This is a very slow command.
   * Will throw an error if redis cannot be reached.
   */
  allDelayed = async (): Promise<{ [timestamp: string]: any[] }> => {
    return api.resque.queue.allDelayed();
  };

  /**
   * Return all workers registered by all members of this cluster.
   * Note: MultiWorker processors each register as a unique worker.
   * Will throw an error if redis cannot be reached.
   */
  workers = async () => {
    return api.resque.queue.workers();
  };

  /**
   * What is a given worker working on?  If the worker is idle, 'started' will be returned.
   * Will throw an error if redis cannot be reached.
   */
  workingOn = async (workerName: string, queues: string): Promise<any> => {
    return api.resque.queue.workingOn(workerName, queues);
  };

  /**
   * Return all workers and what job they might be working on.
   * Will throw an error if redis cannot be reached.
   */
  allWorkingOn = async () => {
    return api.resque.queue.allWorkingOn();
  };

  /**
   * How many jobs are in the failed queue.
   * Will throw an error if redis cannot be reached.
   */
  failedCount = async (): Promise<number> => {
    return api.resque.queue.failedCount();
  };

  /**
   * Retrieve the details of failed jobs between start and stop (0-indexed).
   * Will throw an error if redis cannot be reached.
   */
  failed = async (start: number, stop: number) => {
    return api.resque.queue.failed(start, stop);
  };

  /**
   * Remove a specific job from the failed queue.
   * Will throw an error if redis cannot be reached.
   */
  removeFailed = async (failedJob: ErrorPayload) => {
    return api.resque.queue.removeFailed(failedJob);
  };

  /**
   * Remove a specific job from the failed queue, and retry it by placing it back into its original queue.
   * Will throw an error if redis cannot be reached.
   */
  retryAndRemoveFailed = async (failedJob: ErrorPayload) => {
    return api.resque.queue.retryAndRemoveFailed(failedJob);
  };

  /**
   * If a worker process crashes, it will leave its state in redis as "working".
   * You can remove workers from redis you know to be over, by specificizing an age which would make them too old to exist.
   * This method will remove the data created by a 'stuck' worker and move the payload to the error queue.
   * However, it will not actually remove any processes which may be running.  A job *may* be running that you have removed.
   * Will throw an error if redis cannot be reached.
   */
  cleanOldWorkers = async (age: number) => {
    return api.resque.queue.cleanOldWorkers(age);
  };

  enqueueRecurrent = async (action: Action) => {
    if (action.task && action.task.frequency && action.task.frequency > 0) {
      await api[namespace].del(action.task.queue, action.name);
      await api[namespace].delDelayed(action.task.queue, action.name);
      await api[namespace].enqueueIn(
        action.task.frequency,
        action.name,
        {},
        undefined,
        true,
      );
      logger.debug(`enqueued recurrent job ${action.name}`);
    }
  };

  enqueueAllRecurrent = async (actionName: string) => {
    const enqueuedTasks: string[] = [];
    for (const action of api.actions.actions) {
      if (action.task && action.task.frequency && action.task.frequency > 0) {
        try {
          const toRun = await api[namespace].enqueue(actionName, {});
          if (toRun === true) {
            logger.info(`enqueued recurrent job ${action.name}`);
            enqueuedTasks.push(actionName);
          }
        } catch (error) {
          api[namespace].checkForRepeatRecurringTaskEnqueue(actionName, error);
        }
      }
    }

    return enqueuedTasks;
  };

  /**
   * Stop a task with a frequency by removing it from all possible queues (regular or delayed).
   * Will throw an error if redis cannot be reached.
   */
  stopRecurrentAction = async (actionName: string) => {
    const action = api.actions.actions.find((a) => a.name === actionName);
    if (!action) {
      throw new TypedError({
        message: `action ${actionName} not found`,
        type: ErrorType.CONNECTION_TASK_DEFINITION,
      });
    }
    if (action.task && action.task.frequency && action.task.frequency > 0) {
      let removedCount = 0;
      const count = await api[namespace].del(
        action.task.queue ?? DEFAULT_QUEUE,
        action.name,
        undefined,
        1,
      );
      removedCount = removedCount + count;
      const timestamps = await api[namespace].delDelayed(
        action.task.queue ?? DEFAULT_QUEUE,
        action.name,
      );
      removedCount = removedCount + timestamps.length;
      return removedCount;
    }
  };

  /**
   * Return wholistic details about the task system, including failures, queues, and workers.
   * Will throw an error if redis cannot be reached.
   */
  taskDetails = async () => {
    const details: {
      queues: { [key: string]: any };
      workers: { [key: string]: any };
      stats: { [key: string]: any };
      leader: string;
    } = { queues: {}, workers: {}, stats: {}, leader: "" };

    details.workers = await api[namespace].allWorkingOn();
    details.stats = await api[namespace].resqueStats();
    const queues = await api.resque.queue.queues();

    for (const i in queues) {
      const queue = queues[i];
      const length = await api.resque.queue.length(queue);
      details.queues[queue] = { length: length };
    }

    details.leader = await api.resque.queue.leader();

    return details;
  };

  checkForRepeatRecurringTaskEnqueue = (actionName: string, error: any) => {
    if (error.toString().match(/already enqueued at this time/)) {
      // this is OK, the job was enqueued by another process as this method was running
      logger.warn(
        `not enqueuing periodic task ${actionName} - error.toString()`,
      );
    } else {
      throw error;
    }
  };

  async initialize() {
    const actions = await globLoader<Action>("actions");

    for (const a of actions) {
      if (!a.description) a.description = `An Action: ${a.name}`;
    }

    logger.info(`loaded ${Object.keys(actions).length} actions`);

    return {
      actions,

      enqueue: this.enqueue,
      enqueueAt: this.enqueueAt,
      enqueueIn: this.enqueueIn,
      del: this.del,
      delDelayed: this.delDelayed,
      delByFunction: this.delByFunction,
      scheduledAt: this.scheduledAt,
      resqueStats: this.resqueStats,
      queued: this.queued,
      delQueue: this.delQueue,
      locks: this.locks,
      delLock: this.delLock,
      timestamps: this.timestamps,
      delayedAt: this.delayedAt,
      allDelayed: this.allDelayed,
      workers: this.workers,
      workingOn: this.workingOn,
      allWorkingOn: this.allWorkingOn,
      failed: this.failed,
      failedCount: this.failedCount,
      removeFailed: this.removeFailed,
      retryAndRemoveFailed: this.retryAndRemoveFailed,
      cleanOldWorkers: this.cleanOldWorkers,
      enqueueRecurrent: this.enqueueRecurrent,
      enqueueAllRecurrent: this.enqueueAllRecurrent,
      stopRecurrentAction: this.stopRecurrentAction,
      taskDetails: this.taskDetails,
      checkForRepeatRecurringTaskEnqueue:
        this.checkForRepeatRecurringTaskEnqueue,
    };
  }
}
