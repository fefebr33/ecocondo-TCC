import path from "node:path";
import { defineConfig } from "drizzle-kit";

const databaseFile = path.resolve(process.env.DATABASE_URL || "./data/ecocondo.db");

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: databaseFile,
  },
});
