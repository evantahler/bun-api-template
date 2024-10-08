import { logger, api } from "../api";
import { Initializer } from "../classes/Initializer";
import { ErrorType, TypedError } from "../classes/TypedError";
import { config } from "../config";
import { Redis as RedisClient } from "ioredis";
import { formatConnectionStringForLogging } from "../util/connectionString";

const namespace = "redis";
const testKey = `__actionhero_test_key:${config.process.name}`;

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Redis["initialize"]>>;
  }
}

export class Redis extends Initializer {
  constructor() {
    super(namespace);
    this.startPriority = 110;
    this.stopPriority = 990;
  }

  async initialize() {
    const redisContainer = {} as {
      redis: RedisClient;
      subscription: RedisClient;
    };
    return redisContainer;
  }

  async start() {
    api.redis.redis = new RedisClient(config.redis.connectionString);
    api.redis.subscription = new RedisClient(config.redis.connectionString);

    try {
      await api.redis.redis.set(testKey, Date.now());
      await api.redis.redis.del(testKey);
      await api.redis.subscription.set(testKey, Date.now());
      await api.redis.subscription.del(testKey);
    } catch (e) {
      throw new TypedError({
        type: ErrorType.SERVER_INITIALIZATION,
        message: `Cannot connect to redis (${formatConnectionStringForLogging(config.redis.connectionString)}): ${e}`,
      });
    }

    logger.info(
      `redis connections established (${formatConnectionStringForLogging(config.redis.connectionString)})`,
    );
  }

  async stop() {
    let acted = false;

    if (api.redis.redis) {
      await api.redis.redis.quit();
      acted = true;
    }

    if (api.redis.subscription) {
      await api.redis.subscription.quit();
      acted = true;
    }

    if (acted) logger.info("redis connections closed");
  }
}
