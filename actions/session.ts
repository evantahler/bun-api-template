import { eq } from "drizzle-orm";
import { api, type Action, type ActionParams, Connection } from "../api";
import { users } from "../schema/users";
import { ensureString } from "../util/formatters";
import { emailValidator, passwordValidator } from "../util/validators";
import { serializeUser, checkPassword } from "../ops/UserOps";
import { ErrorType, TypedError } from "../classes/TypedError";
import { HTTP_METHOD } from "../classes/Action";
import type { SessionData } from "../initializers/session";

export class SessionCreate implements Action {
  name = "sessionCreate";
  web = { route: "/session", method: HTTP_METHOD.PUT };
  inputs = {
    email: {
      required: true,
      validator: emailValidator,
      formatter: ensureString,
    },
    password: {
      required: true,
      validator: passwordValidator,
      formatter: ensureString,
    },
  };

  run = async (
    params: ActionParams<SessionCreate>,
    connection: Connection,
  ): Promise<{
    user: Awaited<ReturnType<typeof serializeUser>>;
    session: SessionData;
  }> => {
    const [user] = await api.db.db
      .select()
      .from(users)
      .where(eq(users.email, params.email.toLowerCase()));

    if (!user) {
      throw new TypedError("User not found", ErrorType.CONNECTION_ACTION_RUN);
    }

    const passwordMatch = await checkPassword(user, params.password);
    if (!passwordMatch) {
      throw new TypedError(
        "Password does not match",
        ErrorType.CONNECTION_ACTION_RUN,
      );
    }

    await connection.updateSession({ userId: user.id });

    return {
      user: await serializeUser(user),
      session: connection.session as SessionData,
    };
  };
}
