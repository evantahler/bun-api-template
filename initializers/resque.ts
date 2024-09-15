import {
  logger,
  api,
  config,
  Action,
  Connection,
  type ActionParams,
} from "../api";
import {
  Queue,
  Scheduler,
  MultiWorker,
  type ParsedJob,
  type Job,
} from "node-resque";
import { Initializer } from "../classes/Initializer";

const namespace = "resque";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Resque["initialize"]>>;
  }
}

export class Resque extends Initializer {
  constructor() {
    super(namespace);
    this.loadPriority = 250;
    this.startPriority = 150;
    this.stopPriority = 900;
  }

  startQueue = async () => {
    api.resque.queue = new Queue(
      { connection: { redis: api.redis.redis } },
      api.resque.jobs,
    );

    api.resque.queue.on("error", (error) => {
      logger.error(`[resque:queue] ${error}`);
    });

    await api.resque.queue.connect();
  };

  stopQueue = () => {
    if (api.resque.queue) return api.resque.queue.end();
  };

  startScheduler = async () => {
    if (config.tasks.enabled === true) {
      api.resque.scheduler = new Scheduler({
        connection: { redis: api.redis.redis },
        timeout: config.tasks.timeout,
        stuckWorkerTimeout: config.tasks.stuckWorkerTimeout,
        retryStuckJobs: config.tasks.retryStuckJobs,
      });

      api.resque.scheduler.on("error", (error) => {
        logger.error(`[resque:scheduler] ${error}`);
      });

      await api.resque.scheduler.connect();

      api.resque.scheduler.on("start", () => {
        logger.info(`[resque:scheduler] started`);
      });
      api.resque.scheduler.on("end", () => {
        logger.info(`[resque:scheduler] ended`);
      });
      api.resque.scheduler.on("poll", () => {
        logger.debug(`[resque:scheduler] polling`);
      });
      api.resque.scheduler.on("leader", () => {
        logger.info(`[resque:scheduler] leader elected`);
      });
      api.resque.scheduler.on(
        "cleanStuckWorker",
        (workerName, errorPayload, delta) => {
          logger.warn(
            `[resque:scheduler] cleaning stuck worker: ${workerName}, ${errorPayload}, ${delta}`,
          );
        },
      );

      api.resque.scheduler.start();
    }
  };

  stopScheduler = async () => {
    if (api.resque.scheduler) return api.resque.scheduler.end();
  };

  startMultiWorker = async () => {
    api.resque.multiWorker = new MultiWorker(
      {
        connection: { redis: api.redis.redis },
        queues: Array.isArray(config.tasks.queues)
          ? config.tasks.queues
          : await config.tasks.queues(),
        timeout: config.tasks.timeout,
        checkTimeout: config.tasks.checkTimeout,
        minTaskProcessors: config.tasks.minTaskProcessors,
        maxTaskProcessors: config.tasks.maxTaskProcessors,
        maxEventLoopDelay: config.tasks.maxEventLoopDelay,
      },
      api.resque.jobs,
    );

    // normal worker emitters
    api.resque.multiWorker.on("start", (workerId) => {
      logger.info(`[resque:worker] started, ${workerId}`);
    });
    api.resque.multiWorker.on("end", (workerId) => {
      logger.info(`[resque:worker] ended, ${workerId}`);
    });
    api.resque.multiWorker.on("cleaning_worker", (workerId, worker, pid) => {
      logger.debug(
        `[resque:worker] cleaning worker, ${workerId}, ${worker}, ${pid}`,
      );
    });
    api.resque.multiWorker.on("poll", (workerId, queue) => {
      logger.debug(`[resque:worker] polling, ${workerId}, ${queue}`);
    });
    api.resque.multiWorker.on("job", (workerId, queue, job: ParsedJob) => {
      logger.debug(
        `[resque:worker] job acquired, ${workerId}, ${queue}, ${job.class}, ${JSON.stringify(job.args[0])}`,
      );
    });
    api.resque.multiWorker.on(
      "reEnqueue",
      (workerId, queue, job: ParsedJob, plugin) => {
        logger.debug(
          `[resque:worker] job reEnqueue, ${workerId}, ${queue}, ${job.class}, ${JSON.stringify(job.args[0])}`,
        );
      },
    );
    api.resque.multiWorker.on("pause", (workerId) => {
      logger.debug(`[resque:worker] paused, ${workerId}`);
    });

    api.resque.multiWorker.on("failure", (workerId, queue, job, failure) => {
      logger.info(
        `[resque:worker] job failed, ${workerId}, ${queue}, ${job.class}, ${JSON.stringify(job.args[0])}, ${failure}`,
      );
    });
    api.resque.multiWorker.on("error", (error, workerId, queue, job) => {
      logger.info(
        `[resque:worker] job error, ${workerId}, ${queue}, ${job.class}, ${JSON.stringify(job.args[0])}`,
      );
    });

    api.resque.multiWorker.on(
      "success",
      (workerId, queue, job: ParsedJob, result, duration) => {
        logger.info(
          `[resque:worker] job success, ${workerId}, ${queue}, ${job.class}, ${JSON.stringify(job.args[0])} | ${result} (${duration}ms)`,
        );
      },
    );

    api.resque.multiWorker.on("multiWorkerAction", (verb, delay) => {
      logger.debug(`[resque:worker] multiworker ${verb}, ${delay}`);
    });

    if (config.tasks.minTaskProcessors > 0) {
      api.resque.multiWorker.start();
    }
  };

  stopMultiWorker = async () => {
    if (api.resque.multiWorker && config.tasks.minTaskProcessors > 0) {
      return api.resque.multiWorker.stop();
    }
  };

  /** Load all actions as tasks and wrap them for node-resque jobs */
  loadJobs = async () => {
    const jobs: Record<string, Job<any>> = {};

    for (const action of api.actions.actions) {
      const job = this.wrapActionAsJob(action);
      jobs[action.name] = job;
    }

    return jobs;
  };

  wrapActionAsJob = (
    action: Action,
  ): Job<Awaited<ReturnType<(typeof action)["run"]>>> => {
    const job: Job<ReturnType<Action["run"]>> = {
      plugins: [],
      pluginOptions: {},

      // perform: action.run.bind(action),
      perform: async function (
        params: ActionParams<typeof action>,
        connection: Connection,
      ) {
        let response: Awaited<ReturnType<(typeof action)["run"]>>;
        try {
          response = await action.run(params, connection);
          await api.actions.enqueueRecurrent(action);
        } catch (error) {
          if (
            action.task &&
            action.task.frequency &&
            action.task.frequency > 0
          ) {
            await api.actions.enqueueRecurrent(action);
          }
          throw error;
        }
        return response;
      },
    };

    if (action.task && action.task.frequency && action.task.frequency > 0) {
      job.plugins!.push("JobLock");
      job.pluginOptions!.JobLock = { reEnqueue: false };
      job.plugins!.push("QueueLock");
      job.plugins!.push("DelayQueueLock");
    }

    return job;
  };

  async initialize() {
    const resqueContainer = { jobs: await this.loadJobs() } as {
      queue: Queue;
      scheduler: Scheduler;
      multiWorker: MultiWorker;
      jobs: Awaited<ReturnType<Resque["loadJobs"]>>;
    };

    return resqueContainer;
  }

  async start() {
    if (
      config.tasks.minTaskProcessors === 0 &&
      config.tasks.maxTaskProcessors > 0
    ) {
      config.tasks.minTaskProcessors = 1;
    }

    await this.startQueue();
    await this.startScheduler();
    await this.startMultiWorker();
  }

  async stop() {
    await this.stopScheduler();
    await this.stopMultiWorker();
    await this.stopQueue();
  }
}
