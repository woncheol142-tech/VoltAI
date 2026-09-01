import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const { DatabaseSync } =
  require("node:sqlite") as typeof import("node:sqlite");
export type SqliteDatabase = InstanceType<typeof DatabaseSync>;
