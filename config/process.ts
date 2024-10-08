import { loadFromEnvIfSet } from "../util/config";

export const configProcess = {
  name: await loadFromEnvIfSet("PROCESS_NAME", "server"),
  shutdownTimeout: await loadFromEnvIfSet(
    "PROCESS_SHUTDOWN_TIMEOUT",
    1000 * 30,
  ),
};
