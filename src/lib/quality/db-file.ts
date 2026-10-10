import path from "path";

// The SQLite file Prisma is using. DATABASE_URL is "file:<path>", and Prisma
// resolves a relative path against the prisma/ folder (where schema.prisma is).
export function sqliteFilePath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const file = url.replace(/^file:/, "").split("?")[0];
  return path.isAbsolute(file) ? file : path.join(process.cwd(), "prisma", file);
}
