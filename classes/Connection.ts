import { api, logger } from "../api";
import { config } from "../config";
import colors from "colors";
import type { Action, ActionParams } from "./Action";
import { ErrorType, TypedError } from "./TypedError";
import type { SessionData } from "../initializers/session";
import { randomUUID } from "crypto";
import type { PubSubMessage } from "../initializers/pubsub";

export class Connection<T extends Record<string, any> = Record<string, any>> {
  type: string;
  identifier: string;
  id: string;
  session?: SessionData<T>;
  subscriptions: Set<string>;
  sessionLoaded: boolean;
  rawConnection?: any;

  constructor(
    type: string,
    identifier: string,
    id = randomUUID() as string,
    rawConnection: any = undefined,
  ) {
    this.type = type;
    this.identifier = identifier;
    this.id = id;
    this.sessionLoaded = false;
    this.subscriptions = new Set();
    this.rawConnection = rawConnection;

    api.connections.connections.push(this);
  }

  /**
   * Runs an action for this connection, given FormData params.
   *  Throws errors.
   */
  async act(
    actionName: string | undefined,
    params: FormData, // note: params are not constant for all connections - some are long-lived, like websockets
    method: Request["method"] = "",
    url: string = "",
  ): Promise<{ response: Object; error?: TypedError }> {
    const reqStartTime = new Date().getTime();
    let loggerResponsePrefix: "OK" | "ERROR" = "OK";
    let response: Object = {};
    let error: TypedError | undefined;

    let action: Action | undefined;
    try {
      action = this.findAction(actionName);
      if (!action) {
        throw new TypedError({
          message: `Action not found${actionName ? `: ${actionName}` : ""}`,
          type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
        });
      }

      // load the session once, if it hasn't been loaded yet
      if (!this.sessionLoaded) await this.loadSession();

      const formattedParams = await this.formatParams(params, action);
      response = await action.run(formattedParams, this);
    } catch (e) {
      loggerResponsePrefix = "ERROR";
      error =
        e instanceof TypedError
          ? e
          : new TypedError({
              message: `${e}`,
              type: ErrorType.CONNECTION_ACTION_RUN,
              originalError: e,
            });
    }

    // Note: we want the params object to remain on the same line as the message, so we stringify
    const sanitizedParams = sanitizeParams(params, action);
    const loggingParams = config.logger.colorize
      ? colors.gray(JSON.stringify(sanitizedParams))
      : JSON.stringify(sanitizedParams);

    const statusMessage = `[ACTION:${loggerResponsePrefix}]`;
    const messagePrefix = config.logger.colorize
      ? loggerResponsePrefix === "OK"
        ? colors.bgBlue(statusMessage)
        : colors.bgMagenta(statusMessage)
      : statusMessage;

    const duration = new Date().getTime() - reqStartTime;

    logger.info(
      `${messagePrefix} ${actionName} (${duration}ms) ${method.length > 0 ? `[${method}]` : ""} ${this.identifier}${url.length > 0 ? `(${url})` : ""} ${error ? error : ""} ${loggingParams}`,
    );

    return { response, error };
  }

  async updateSession(data: Partial<T>) {
    await this.loadSession();

    if (!this.session) {
      throw new TypedError({
        message: "Session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    return api.session.update(this.session, data);
  }

  subscribe(channel: string) {
    this.subscriptions.add(channel);
  }

  unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
  }

  async broadcast(channel: string, message: string) {
    if (!this.subscriptions.has(channel)) {
      throw new TypedError({
        message: "not subscribed to this channel",
        type: ErrorType.CONNECTION_NOT_SUBSCRIBED,
      });
    }

    return api.pubsub.broadcast(channel, message, this.id);
  }

  onBroadcastMessageReceived(payload: PubSubMessage) {
    throw new Error(
      "unimplemented - this should be overwritten by connections that support it",
    );
  }

  destroy() {
    return api.connections.destroy(this.type, this.identifier, this.id);
  }

  private async loadSession() {
    if (this.session) return;

    const session = await api.session.load(this);
    if (session) {
      this.session = session as SessionData<T>;
    } else {
      this.session = await api.session.create(this);
    }
  }

  private findAction(actionName: string | undefined) {
    return api.actions.actions.find((a) => a.name === actionName);
  }

  private async formatParams(params: FormData, action: Action) {
    if (!action.inputs) return {} as ActionParams<Action>;

    const formattedParams = {} as ActionParams<Action>;

    for (const [key, paramDefinition] of Object.entries(action.inputs)) {
      let value = params.get(key); // TODO: handle getAll for multiple values

      try {
        if (
          (value === null || value === undefined) &&
          paramDefinition.default !== undefined &&
          paramDefinition.default !== null
        ) {
          value =
            typeof paramDefinition.default === "function"
              ? paramDefinition.default(value)
              : paramDefinition.default;
        }
      } catch (e) {
        throw new TypedError({
          message: `Error creating default value for for param ${key}: ${e}`,
          type: ErrorType.CONNECTION_ACTION_PARAM_DEFAULT,
          originalError: e,
        });
      }

      if (
        paramDefinition.required === true &&
        (value === undefined || value === null)
      ) {
        throw new TypedError({
          message: `Missing required param: ${key}`,
          type: ErrorType.CONNECTION_ACTION_PARAM_REQUIRED,
          key,
        });
      }

      if (paramDefinition.formatter && value !== undefined && value !== null) {
        try {
          value = paramDefinition.formatter(value);
        } catch (e) {
          throw new TypedError({
            message: `${e}`,
            type: ErrorType.CONNECTION_ACTION_PARAM_FORMATTING,
            key,
            value,
            originalError: e,
          });
        }
      }

      if (paramDefinition.validator && value !== undefined && value !== null) {
        let validationResponse: string | boolean | Error = false;

        try {
          validationResponse = paramDefinition.validator(value);
        } catch (e) {
          if (e instanceof Error) validationResponse = e;
        }

        if (
          validationResponse instanceof Error ||
          validationResponse === false
        ) {
          throw new TypedError({
            message:
              validationResponse instanceof Error
                ? validationResponse.message
                : `Validation failed for param ${key}`,
            type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
            key,
            value,
          });
        }
      }

      formattedParams[key] = value as any;
    }

    return formattedParams;
  }
}

const REDACTED = "[[secret]]" as const;

const sanitizeParams = (params: FormData, action: Action | undefined) => {
  const sanitizedParams: Record<string, any> = {};
  params.forEach((v, k) => {
    if (action && action?.inputs[k]?.secret === true) {
      sanitizedParams[k] = REDACTED;
    } else {
      sanitizedParams[k] = v;
    }
  });

  return sanitizedParams;
};
