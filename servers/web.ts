import cookie from "cookie";
import { Connection } from "../classes/Connection";
import { ErrorType, TypedError } from "../classes/TypedError";
import { Server } from "../classes/Server";
import { config } from "../config";
import { logger, api } from "../api";
import { parse } from "node:url";
import {
  type HTTP_METHOD,
  type WebsocketActionParams,
} from "../classes/Action";
import type { ServerWebSocket } from "bun";
import type {
  ClientSubscribeMessage,
  ClientUnsubscribeMessage,
  PubSubMessage,
} from "../initializers/pubsub";
import httpProxy from "http-proxy";
import http from "node:http";

export class WebServer extends Server<ReturnType<typeof Bun.serve>> {
  proxyServer?: ReturnType<(typeof http)["createServer"]>;

  constructor() {
    super("web");
  }

  async initialize() {}

  async start() {
    if (config.server.web.enabled !== true) return;

    logger.info(
      `starting proxy server @ ${config.server.web.applicationUrl} (via bind @ ${config.server.web.host}:${config.server.web.port})`,
    );

    const appProxy = httpProxy
      .createProxy({
        target: {
          host: config.server.web.host,
          port: config.server.web.port + 1,
        },
        ws: true,
      })
      .on("error", (e) => {
        throw new TypedError({
          message: `appProxy error: ${e}`,
          type: ErrorType.SERVER_START,
        });
      });

    const nextProxy = httpProxy
      .createProxy({
        target: {
          host: config.server.web.host,
          port: config.server.web.port + 2,
        },
        ws: true,
      })
      .on("error", (e) => {
        throw new TypedError({
          message: `nextProxy error: ${e}`,
          type: ErrorType.SERVER_START,
        });
      });

    this.proxyServer = http
      .createServer((req, res) => {
        if (req.url && req.url.startsWith(config.server.web.apiRoute)) {
          appProxy.web(req, res);
        } else {
          nextProxy.web(req, res);
        }
      })
      .on("upgrade", (req, socket, head) => {
        if (req.url && req.url.startsWith("/_next/")) {
          console.log(">>> upgrade NEXT", req.url);
          nextProxy.ws(req, socket, head);
        } else {
          console.log(">>> upgrade APP", req.url);
          appProxy.ws(req, socket, head);
        }
      })
      .on("error", (e) => {
        logger.error(`proxy server error: ${e}`);
      });

    logger.info(
      `starting app server @ ${config.server.web.host}:${config.server.web.port + 1}`,
    );

    this.server = Bun.serve({
      port: config.server.web.port + 1,
      hostname: config.server.web.host,

      // error: (error) => {
      //   return new Response(`Error: ${error.message}`);
      // },
      fetch: this.handleIncomingConnection.bind(this),
      websocket: {
        open: this.handleWebSocketConnectionOpen.bind(this),
        message: this.handleWebSocketConnectionMessage.bind(this),
        close: this.handleWebSocketConnectionClose.bind(this),
      },
    });

    await Bun.sleep(1);
    this.proxyServer?.listen(config.server.web.port, config.server.web.host);
  }

  async stop() {
    //TODO: Graceful shutdown
    // in test, we want to hard-kill the server
    if (this.proxyServer) {
      this.proxyServer.close();
      logger.info(
        `stopped proxy server @ ${config.server.web.applicationUrl} (via bind @ ${config.server.web.host}:${config.server.web.port})`,
      );
    }
    if (this.server) {
      this.server.stop(true);
      logger.info(
        `stopped app server @ ${config.server.web.host}:${config.server.web.port + 1}`,
      );
    }

    // while (this.server.pendingRequests + this.server.pendingWebSockets > 0) {
    //   logger.debug(
    //     `server stop pending pendingRequests:${this.server.pendingRequests}, pendingWebSockets:${this.server.pendingWebSockets}`,
    //   );
    //   await Bun.sleep(1000);
    // }
  }

  async handleIncomingConnection(
    req: Request,
    server: ReturnType<typeof Bun.serve>,
  ) {
    const isCorrectUrl = checkApplicationUrl(req);
    if (!isCorrectUrl) {
      return Response.redirect(config.server.web.applicationUrl + req.url, 302);
    }

    const ip = server.requestIP(req)?.address || "unknown-IP";
    const headers = req.headers;
    const cookies = cookie.parse(req.headers.get("cookie") ?? "");
    const id = cookies[config.session.cookieName];

    if (server.upgrade(req, { data: { ip, id, headers, cookies } })) return; // upgrade the request to a WebSocket

    const parsedUrl = parse(req.url!, true);
    if (parsedUrl.path?.startsWith(`${config.server.web.apiRoute}/`)) {
      return this.handleWebAction(req, parsedUrl, ip, id);
      // } else if (typeof api.next.app) {
      //   const originalHost = req.headers.get("host");
      //   if (!originalHost) {
      //     throw new TypedError({
      //       type: ErrorType.CONNECTION_SERVER_ERROR,
      //       message: "no host header",
      //     });
      //   }

      //   // forward the request to the next.js socket
      //   const response = await fetch(req.url, {
      //     headers: req.headers,
      //     method: req.method,
      //     body: req.body,
      //     // @ts-ignore - This is added by Bun to allow connecting to unix sockets
      //     unix: api.next.socket,
      //   });

      //   response.headers.set("x-server-name", config.process.name);

      //   response.headers.delete("date"); // both the Bun and Next servers try to set date - we only want one
      //   response.headers.delete("content-encoding"); // we've already un-zipped the response, if it was

      //   return response;
    } else {
      return buildError(
        undefined,
        new TypedError({
          message: "static server not enabled",
          type: ErrorType.CONNECTION_SERVER_ERROR,
        }),
        404,
      );
    }
  }

  handleWebSocketConnectionOpen(ws: ServerWebSocket) {
    console.log("handleWebSocketConnectionOpen", ws.data);

    //@ts-expect-error (ws.data is not defined in the bun types)
    const connection = new Connection("websocket", ws.data.ip, ws.data.id, ws);
    connection.onBroadcastMessageReceived = function (payload: PubSubMessage) {
      ws.send(JSON.stringify({ message: payload }));
    };
    logger.info(
      `New websocket connection from ${connection.identifier} (${connection.id})`,
    );
  }

  async handleWebSocketConnectionMessage(
    ws: ServerWebSocket,
    message: string | Buffer,
  ) {
    const { connection } = api.connections.find(
      "websocket",
      //@ts-expect-error
      ws.data.ip,
      //@ts-expect-error
      ws.data.id,
    );

    try {
      const parsedMessage = JSON.parse(message.toString());
      if (parsedMessage["messageType"] === "action") {
        this.handleWebsocketAction(connection, ws, parsedMessage);
      } else if (parsedMessage["messageType"] === "subscribe") {
        this.handleWebsocketSubscribe(connection, ws, parsedMessage);
      } else if (parsedMessage["messageType"] === "unsubscribe") {
        this.handleWebsocketUnsubscribe(connection, ws, parsedMessage);
      } else {
        throw new TypedError({
          message: `messageType either missing or unknown`,
          type: ErrorType.CONNECTION_TYPE_NOT_FOUND,
        });
      }
    } catch (e) {
      ws.send(
        JSON.stringify({
          error: buildErrorPayload(
            new TypedError({
              message: `${e}`,
              type: ErrorType.CONNECTION_ACTION_RUN,
            }),
          ),
        }),
      );
    }
  }

  handleWebSocketConnectionClose(ws: ServerWebSocket) {
    const { connection } = api.connections.find(
      "websocket",
      //@ts-expect-error
      ws.data.ip,
      //@ts-expect-error
      ws.data.id,
    );
    try {
      connection.destroy();
      logger.info(
        `websocket connection closed from ${connection.identifier} (${connection.id})`,
      );
    } catch (e) {
      logger.error(`Error destroying connection: ${e}`);
    }
  }

  async handleWebsocketAction(
    connection: Connection,
    ws: ServerWebSocket,
    formattedMessage: WebsocketActionParams<any>,
  ) {
    const params = new FormData();
    for (const [key, value] of Object.entries(formattedMessage.params)) {
      params.append(key, value);
    }

    const { response, error } = await connection.act(
      formattedMessage.action,
      params,
      "WEBSOCKET",
    );

    if (error) {
      ws.send(
        JSON.stringify({
          error: {
            messageId: formattedMessage.messageId,
            error: { ...buildErrorPayload(error) },
          },
        }),
      );
    } else {
      ws.send(
        JSON.stringify({
          messageId: formattedMessage.messageId,
          response: { ...response },
        }),
      );
    }
  }

  async handleWebsocketSubscribe(
    connection: Connection,
    ws: ServerWebSocket,
    formattedMessage: ClientSubscribeMessage,
  ) {
    connection.subscribe(formattedMessage.channel);
    ws.send(
      JSON.stringify({
        messageId: formattedMessage.messageId,
        subscribed: { channel: formattedMessage.channel },
      }),
    );
  }

  async handleWebsocketUnsubscribe(
    connection: Connection,
    ws: ServerWebSocket,
    formattedMessage: ClientUnsubscribeMessage,
  ) {
    connection.unsubscribe(formattedMessage.channel);
    ws.send(
      JSON.stringify({
        messageId: formattedMessage.messageId,
        unsubscribed: { channel: formattedMessage.channel },
      }),
    );
  }

  async handleWebAction(
    req: Request,
    url: ReturnType<typeof parse>,
    ip: string,
    id: string,
  ) {
    if (!this.server) {
      throw new TypedError({
        message: "Server server not started",
        type: ErrorType.SERVER_START,
      });
    }

    let errorStatusCode = 500;
    const httpMethod = req.method?.toUpperCase() as HTTP_METHOD;

    const connection = new Connection("web", ip, id);
    const actionName = await this.determineActionName(url, httpMethod);
    if (!actionName) errorStatusCode = 404;

    // param load order: url params -> body params -> query params
    let params = new FormData();

    if (
      req.method !== "GET" &&
      req.headers.get("content-type") === "application/json"
    ) {
      try {
        const bodyContent = await req.json();
        for (const [key, value] of Object.entries(bodyContent)) {
          params.set(key, value as any);
        }
      } catch (e) {
        throw new TypedError({
          message: `cannot parse request body: ${e}`,
          type: ErrorType.CONNECTION_ACTION_RUN,
          originalError: e,
        });
      }
    } else if (
      req.method !== "GET" &&
      (req.headers.get("content-type")?.includes("multipart/form-data") ||
        req.headers
          .get("content-type")
          ?.includes("application/x-www-form-urlencoded"))
    ) {
      const f = await req.formData();
      f.forEach((value, key) => {
        params.append(key, value);
      });

      // // TODO: FILES

      // // for (const [key, values] of Object.entries(files)) {
      // //   if (values !== undefined) {
      // //     if (Array.isArray(values)) {
      // //       for (const v of values) params.append(key, v);
      // //     } else {
      // //       params.append(key, values);
      // //     }
      // //   }
      // // }
    }

    if (url.query) {
      for (const [key, values] of Object.entries(url.query)) {
        if (values !== undefined) {
          if (Array.isArray(values)) {
            for (const v of values) params.append(key, v);
          } else {
            params.append(key, values);
          }
        }
      }
    }

    const { response, error } = await connection.act(
      actionName,
      params,
      httpMethod,
      req.url,
    );

    connection.destroy();

    return error
      ? buildError(connection, error, errorStatusCode)
      : buildResponse(connection, response);
  }

  async determineActionName(
    url: ReturnType<typeof parse>,
    method: HTTP_METHOD,
  ) {
    const pathToMatch = url.pathname?.replace(
      new RegExp(`${config.server.web.apiRoute}`),
      "",
    );

    for (const action of api.actions.actions) {
      if (!action?.web?.route) continue;

      const matcher =
        action.web.route instanceof RegExp
          ? action.web.route
          : new RegExp(`^${action.web.route}$`);

      if (
        pathToMatch &&
        pathToMatch.match(matcher) &&
        method.toUpperCase() === action.web.method
      ) {
        return action.name;
      }
    }
  }
}

const buildHeaders = (connection?: Connection) => {
  const headers: Record<string, string> = {};

  headers["Content-Type"] = "application/json";
  headers["x-server-name"] = config.process.name;

  if (connection) {
    headers["Set-Cookie"] =
      `${config.session.cookieName}=${connection.id}; Max-Age=${config.session.ttl}; Path=/`; //HttpOnly; SameSite=Strict;
  }

  return headers;
};

function buildResponse(connection: Connection, response: Object, status = 200) {
  return new Response(JSON.stringify(response, null, 2) + EOL, {
    status,
    headers: buildHeaders(connection),
  });
}

function buildError(
  connection: Connection | undefined,
  error: TypedError,
  status = 500,
) {
  return new Response(
    JSON.stringify({ error: buildErrorPayload(error) }, null, 2) + EOL,
    {
      status,
      headers: buildHeaders(connection),
    },
  );
}

function buildErrorPayload(error: TypedError) {
  return {
    message: error.message,
    type: error.type,
    timestamp: new Date().getTime(),
    key: error.key !== undefined ? error.key : undefined,
    value: error.value !== undefined ? error.value : undefined,
    stack: error.stack,
  };
}

function checkApplicationUrl(req: Request) {
  if (config.server.web.applicationUrl.length > 3) {
    const hostHeader = req.headers.get("host");
    const forwardHeader = req.headers.get("x-forwarded-proto");

    const requestHost = forwardHeader
      ? forwardHeader + "://" + hostHeader
      : "http://" + hostHeader;

    if (config.server.web.applicationUrl !== requestHost) return false;
  }

  return true;
}

const EOL = "\r\n";
