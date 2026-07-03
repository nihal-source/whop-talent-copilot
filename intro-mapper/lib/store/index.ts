import type { Store } from "./interface";
import { MemoryStore } from "./memory";

export type { Store } from "./interface";

let store: Store | null = null;

/**
 * Returns the process-wide store. Uses Postgres when DATABASE_URL is set,
 * otherwise an in-memory store so the app runs with zero external dependencies
 * during local development. The Postgres module is imported lazily so `pg` is
 * never required unless a connection string is configured.
 */
export async function getStore(): Promise<Store> {
  if (store) return store;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { PostgresStore } = await import("./pg");
    store = new PostgresStore(new Pool({ connectionString: url }));
  } else {
    store = new MemoryStore();
  }
  return store;
}
