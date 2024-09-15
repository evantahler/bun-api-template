import { logger, api } from "../api";
import { Initializer } from "../classes/Initializer";
import { config } from "../config";
import { Redis as RedisClient } from "ioredis";

const namespace = "redis";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Redis["initialize"]>>;
  }
}

export class Redis extends Initializer {
  constructor() {
    super(namespace);
    this.loadPriority = 200;
    this.startPriority = 110;
    this.stopPriority = 900;
  }

  async initialize() {
    const redisContainer = {} as {
      redis: RedisClient;
      subscriber: RedisClient;
    };
    return redisContainer;
  }

  async start() {
    api.redis.redis = new RedisClient(config.redis.connectionString);
    api.redis.subscriber = new RedisClient(config.redis.connectionString);
    await Bun.sleep(1);
    logger.info("redis connections established");
  }

  async stop() {
    if (api.redis.redis) {
      await api.redis.redis.quit(); // will wait for all pending commands to complete
      logger.debug("redis:redis connection closed");
    }
    if (api.redis.subscriber) {
      await api.redis.subscriber.quit(); // will wait for all pending commands to complete
      logger.debug("redis:subscriber connection closed");
    }
    logger.info("redis connections closed");
  }
}
