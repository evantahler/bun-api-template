import { loadFromEnvIfSet } from "../util/config";

export const configNext = {
  dev: await loadFromEnvIfSet("NEXT_DEV", false),
};
