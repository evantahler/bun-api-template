import { loadFromEnvIfSet } from "../util/config";

export const configTasks = {
  enabled: await loadFromEnvIfSet("TASKS_ENABLED", true),

  // what queues should the taskProcessors work?
  queues: ["*"] as string[] | (() => Promise<string[]>),
  // Or, rather than providing a static list of `queues`, you can define a method that returns the list of queues.
  // queues: async () => { return ["queueA", "queueB"]; } as string[] | (() => Promise<string[]>)>,

  // how long to sleep between jobs / scheduler checks
  timeout: 5000,
  // at minimum, how many parallel taskProcessors should this node spawn?
  // (have number > 0 to enable, and < 1 to disable)
  minTaskProcessors: 0,
  // at maximum, how many parallel taskProcessors should this node spawn?
  maxTaskProcessors: 0,
  // how often should we check the event loop to spawn more taskProcessors?
  checkTimeout: 500,
  // how many ms would constitute an event loop delay to halt taskProcessors spawning?
  maxEventLoopDelay: 5,
  // how long before we mark a resque worker / task processor as stuck/dead?
  stuckWorkerTimeout: 1000 * 60 * 60,
  // should the scheduler automatically try to retry failed tasks which were failed due to being 'stuck'?
  retryStuckJobs: false,
};
