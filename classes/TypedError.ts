export enum ErrorType {
  // general
  "SERVER_INITIALIZATION" = "SERVER_INITIALIZATION",
  "SERVER_START" = "SERVER_START",
  "SERVER_STOP" = "SERVER_STOP",

  // init
  "CONFIG_ERROR" = "CONFIG_ERROR",
  "INITIALIZER_VALIDATION" = "INITIALIZER_VALIDATION",
  "ACTION_VALIDATION" = "ACTION_VALIDATION",
  "TASK_VALIDATION" = "TASK_VALIDATION",
  "SERVER_VALIDATION" = "SERVER_VALIDATION",

  // session
  "CONNECTION_SESSION_NOT_FOUND" = "CONNECTION_SESSION_NOT_FOUND",

  // actions
  "CONNECTION_SERVER_ERROR" = "CONNECTION_SERVER_ERROR",
  "CONNECTION_ACTION_NOT_FOUND" = "CONNECTION_ACTION_NOT_FOUND",
  "CONNECTION_ACTION_PARAM_REQUIRED" = "CONNECTION_ACTION_PARAM_REQUIRED",
  "CONNECTION_ACTION_PARAM_DEFAULT" = "CONNECTION_ACTION_PARAM_DEFAULT",
  "CONNECTION_ACTION_PARAM_VALIDATION" = "CONNECTION_ACTION_PARAM_VALIDATION",
  "CONNECTION_ACTION_PARAM_FORMATTING" = "CONNECTION_ACTION_PARAM_FORMATTING",
  "CONNECTION_ACTION_RUN" = "CONNECTION_ACTION_RUN",
  "CONNECTION_TYPE_NOT_FOUND" = "CONNECTION_TYPE_NOT_FOUND",
  "CONNECTION_NOT_SUBSCRIBED" = "CONNECTION_NOT_SUBSCRIBED",
}

export type TypedErrorArgs = {
  message: string;
  type: ErrorType;
  originalError?: unknown;
  key?: string;
  value?: any;
};

export class TypedError extends Error {
  type: ErrorType;
  key?: string;
  value?: any;

  constructor(args: TypedErrorArgs) {
    super(args.message);
    this.type = args.type;
    this.key = args.key;
    this.value = args.value;

    if (args.originalError !== undefined) {
      if (args.originalError instanceof Error) {
        this.stack = args.originalError.stack;
      } else {
        this.stack = `OriginalStringError: ${args.originalError}`;
      }
    }
  }
}
