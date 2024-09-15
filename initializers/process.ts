import { logger } from "../api";
import { Initializer } from "../classes/Initializer";
import { config } from "../config";

const namespace = "process";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Process["initialize"]>>;
  }
}

export class Process extends Initializer {
  constructor() {
    super(namespace);
    this.loadPriority = 2;
  }

  async initialize() {
    const name = config.process.name;
    const pid = process.pid;
    logger.info(`Process: ${name}, pid: ${pid}`);
    return { name, pid };
  }
}
