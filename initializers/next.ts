import next from "next";
import path from "node:path";
import type { NextServer } from "next/dist/server/next";
import { Initializer } from "../classes/Initializer";
import { api, logger, RUN_MODE } from "../api";
import { config } from "../config";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { monkeyPatchLogging } from "../util/consoleLoggingPatches";
import { parse } from "url";
import { unlink } from "node:fs/promises";
import colors from "colors";
import { parseHeadersForClientAddress } from "../util/parseHeadersForClientAddress";

const namespace = "next";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Next["initialize"]>>;
  }
}

/**
 * Programmatically load and start a Next.js server and attach to our web server
 */
export class Next extends Initializer {
  constructor() {
    super(namespace);
    // load and start after the webserver
    this.loadPriority = 850;
    this.startPriority = 550;
    this.runModes = [RUN_MODE.SERVER];
  }

  async initialize() {
    return {} as {
      app: NextServer;
      server: ReturnType<typeof createServer>;
    };
  }

  async start() {
    if (config.server.web.enabled !== true) return;

    monkeyPatchLogging();

    if (config.next.dev) {
      logger.info("Running next.js in development mode");
    }

    api[namespace].app = next({
      dev: config.next.dev,
      quiet: false,
      dir: path.join(__dirname, ".."),
    });

    await api[namespace].app.prepare();
    const handle = api[namespace].app.getRequestHandler();

    api[namespace].server = createServer((req, res) => {
      const parsedUrl = parse(req.url!, true);
      handle(req, res, parsedUrl);
      logNextRequest(req, res, parsedUrl);
    }).listen(config.server.web.port + 2, config.server.web.host);

    logger.info(
      `next.js server ready on ${config.server.web.host}:${config.server.web.port + 2}`,
    );
  }

  async stop() {
    if (api[namespace].app) {
      await api[namespace].app.close();
    }
  }
}

const logNextRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  url: ReturnType<typeof parse>,
) => {
  const startTime = new Date().getTime();
  const { ip } = parseHeadersForClientAddress(req);

  res.on("finish", () => {
    const loggingQuery = config.logger.colorize
      ? colors.gray(JSON.stringify(url.query))
      : JSON.stringify(url.query);

    const statusMessage = `[ASSET:${res.statusCode}]`;
    const messagePrefix = config.logger.colorize
      ? res.statusCode >= 200 && res.statusCode < 400
        ? colors.bgBlue(statusMessage)
        : colors.bgMagenta(statusMessage)
      : statusMessage;

    const duration = new Date().getTime() - startTime;
    const message = `${messagePrefix} ${url.path} (${duration}ms) ${req.method && req.method?.length > 0 ? `[${req.method}]` : ""} ${ip} ${loggingQuery}`;

    logger.info(config.logger.colorize ? colors.gray(message) : message);
  });
};
