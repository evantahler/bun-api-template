import { desc, eq, lt } from "drizzle-orm";
import { api, Connection, type Action, type ActionParams } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { serializeMessage } from "../ops/MessageOps";
import { messages } from "../schema/messages";
import { ensureNumber, ensureString } from "../util/formatters";
import { ensureSession } from "../util/session";
import { messageValidator } from "../util/validators";
import { users } from "../schema/users";
import type { SessionImpl } from "./session";

export class MessageCrete implements Action {
  name = "message:create";
  description = "Create a message";
  web = { route: "/message", method: HTTP_METHOD.PUT };
  inputs = {
    body: {
      required: true,
      validator: messageValidator,
      formatter: ensureString,
      description: "The message",
    },
  };

  async run(
    params: ActionParams<MessageCrete>,
    connection: Connection<SessionImpl>,
  ) {
    ensureSession(connection, "userId");

    const [message] = await api.db.db
      .insert(messages)
      .values({
        body: params.body,
        user_id: connection!.session!.data.userId!,
      })
      .returning();

    return { message: serializeMessage(message) };
  }
}

export class MessagesList implements Action {
  name = "messages:list";
  description = "List messages";
  web = { route: "/messages/list", method: HTTP_METHOD.GET };
  inputs = {
    limit: {
      required: true,
      formatter: ensureNumber,
      default: 10,
    },
    offset: {
      required: true,
      formatter: ensureNumber,
      default: 0,
    },
  };

  async run(
    params: ActionParams<MessagesList>,
    connection: Connection<SessionImpl>,
  ) {
    ensureSession(connection, "userId");

    const _messages = await api.db.db
      .select({
        id: messages.id,
        body: messages.body,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,
        user_id: messages.user_id,
        user_name: users.name,
      })
      .from(messages)
      .orderBy(desc(messages.id))
      .limit(params.limit)
      .offset(params.offset)
      .leftJoin(users, eq(users.id, messages.user_id));

    return {
      messages: _messages.map((m) =>
        serializeMessage(m, m.user_name ? m.user_name : undefined),
      ),
    };
  }
}

export class MessagesCleanup implements Action {
  name = "messages:cleanup";
  description = "cleanup messages older than 24 hours";
  task = { frequency: 1000 * 60 * 60, queue: "default" }; // run the task every hour
  inputs = {
    age: {
      required: true,
      formatter: ensureNumber,
      default: 1000 * 60 * 60 * 24, // 24 hours
    },
  };

  async run(params: ActionParams<MessagesCleanup>) {
    const _messages = await api.db.db
      .delete(messages)
      .where(lt(messages.createdAt, new Date(Date.now() - params.age)))
      .returning();

    return {
      messages: _messages.map((m) => serializeMessage(m)),
    };
  }
}
