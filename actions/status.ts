import { api, Action, type Inputs } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import packageJSON from "../package.json";

export class Status implements Action {
  name = "status";
  inputs = {};
  web = { route: "/status", method: HTTP_METHOD.GET };

  async run() {
    const consumedMemoryMB =
      Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;

    return {
      name: api.process.name,
      pid: api.process.pid,
      version: packageJSON.version,
      uptime: new Date().getTime() - api.bootTime,
      consumedMemoryMB,
    };
  }
}
