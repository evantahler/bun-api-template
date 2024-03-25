import { api, logger } from "../api";
import { Initializer } from "../classes/Initializer";
import { config } from "../config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import path from "path";
import { type Config as DrizzleMigrateConfig } from "drizzle-kit";
import { unlink } from "node:fs/promises";
import { $ } from "bun";
import { ErrorType, TypedError } from "../classes/TypedError";

const namespace = "db";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<DB["initialize"]>>;
  }
}

export class DB extends Initializer {
  constructor() {
    super(namespace);
    this.startPriority = 100;
  }

  async initialize() {
    const dbContainer = {} as { db: ReturnType<typeof drizzle> };
    return Object.assign(
      {
        generateMigrations: this.generateMigrations,
        clearDatabase: this.clearDatabase,
      },
      dbContainer,
    );
  }

  async start() {
    const pool = new Pool({
      connectionString: config.database.connectionString,
    });

    api.db.db = drizzle(pool);

    if (config.database.autoMigrate) {
      await migrate(api.db.db, { migrationsFolder: "./drizzle" });
      logger.info("database migrated successfully");
    }

    logger.info("database connection established");
  }

  /**
   * Generate migrations for the database schema.
   * Learn more @ https://orm.drizzle.team/kit-docs/overview
   */
  async generateMigrations() {
    const migrationConfig = {
      schema: path.join("schema", "*"),
      dbCredentials: {
        uri: config.database.connectionString,
      },
      out: path.join("drizzle"),
    } satisfies DrizzleMigrateConfig;

    const fileContent = `export default ${JSON.stringify(migrationConfig, null, 2)}`;
    const tmpfilePath = path.join(api.rootDir, "drizzle", "config.tmp.ts");

    try {
      await Bun.write(tmpfilePath, fileContent);
      const { exitCode, stdout, stderr } =
        await $`bun drizzle-kit generate:pg --config ${tmpfilePath}`.quiet();
      logger.trace(stdout.toString());
      if (exitCode !== 0) {
        {
          throw new TypedError(
            `Failed to generate migrations: ${stderr.toString()}`,
            ErrorType.SERVER_INITIALIZATION,
          );
        }
      }
    } finally {
      const filePointer = Bun.file(tmpfilePath);
      if (await filePointer.exists()) await unlink(tmpfilePath);
    }
  }

  /**
   * Erase all the tables in the active database.  Will fail on production environments.
   */
  async clearDatabase(restartIdentity = true, cascade = true) {
    if (Bun.env.NODE_ENV === "production") {
      throw new TypedError(
        "clearDatabase cannot be called in production",
        ErrorType.SERVER_INITIALIZATION,
      );
    }

    const { rows } = await api.db.db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = CURRENT_SCHEMA`,
    );

    for (const row of rows) {
      logger.debug(`truncating table ${row.tablename}`);
      await api.db.db.execute(
        sql.raw(
          `TRUNCATE TABLE "${row.tablename}" ${restartIdentity ? "RESTART IDENTITY" : ""} ${cascade ? "CASCADE" : ""} `,
        ),
      );
    }
  }
}
