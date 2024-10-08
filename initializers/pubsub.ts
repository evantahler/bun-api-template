import pkg from "../package.json";
import { api } from "../api";
import { Initializer } from "../classes/Initializer";

const namespace = "pubsub";
const redisPubSubChannel = `actionhero:pubsub:${pkg.name}`;

// TODO: Presence (connections in room), including join/leave
// TODO: Auth (key/values to check access

export type PubSubMessage = {
  channel: string;
  message: string;
  sender: string;
};

export type ClientSubscribeMessage = {
  messageType: "subscribe";
  messageId: string | number;
  channel: string;
};

export type ClientUnsubscribeMessage = {
  messageType: "unsubscribe";
  messageId: string | number;
  channel: string;
};

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<PubSub["initialize"]>>;
  }
}

export class PubSub extends Initializer {
  constructor() {
    super(namespace);
    this.startPriority = 150;
    this.stopPriority = 950;
  }

  async initialize() {
    async function broadcast(
      channel: string,
      message: any,
      sender = "unknown-sender",
    ) {
      const payload: PubSubMessage = { channel, message, sender };
      return api.redis.redis.publish(
        redisPubSubChannel,
        JSON.stringify(payload),
      );
    }

    return { broadcast };
  }

  async start() {
    if (api.redis.subscription) {
      api.redis.subscription.subscribe(redisPubSubChannel);
      api.redis.subscription.on("message", this.handleMessage.bind(this));
    }
  }

  async stop() {
    if (api.redis.subscription) {
      api.redis.subscription.unsubscribe(redisPubSubChannel);
    }
  }

  async handleMessage(pubSubChannel: string, incomingMessage: string | Buffer) {
    const payload = JSON.parse(incomingMessage.toString()) as PubSubMessage;
    for (const connection of api.connections.connections) {
      if (connection.subscriptions.has(payload.channel)) {
        connection.onBroadcastMessageReceived(payload);
      }
    }
  }
}
