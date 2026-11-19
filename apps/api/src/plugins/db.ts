import { createDb, type Db } from "@lift/db";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    /** Drizzle on the platform database (packages/db). */
    db: Db;
  }
}

/** Opens the Postgres pool (it connects on first use) and closes it with the server. */
export function registerDb(app: FastifyInstance, url: string): void {
  const { db, close } = createDb(url);
  app.decorate("db", db);
  app.addHook("onClose", async () => {
    await close();
  });
}
