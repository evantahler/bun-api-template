import { Connection, api } from "../api";
import { Initializer } from "../classes/Initializer";

const namespace = "connections";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<Connections["initialize"]>>;
  }
}

export class Connections extends Initializer {
  constructor() {
    super(namespace);
    this.loadPriority = 1;
  }

  async initialize() {
    function find(type: string, identifier: string, id: string) {
      const index = api.connections.connections.findIndex(
        (c) => c.type === type && c.id === id && c.identifier === identifier,
      );

      return { connection: api.connections.connections[index], index };
    }

    function destroy(type: string, identifier: string, id: string) {
      const { connection, index } = find(type, identifier, id);
      if (connection) {
        return api.connections.connections.splice(index, 1);
      }
    }

    return { connections: [] as Connection[], find, destroy };
  }
}
