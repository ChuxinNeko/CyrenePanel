import { Elysia } from "elysia";
import { mysqlConnectionRoutes } from "./connections";
import { mysqlQueryRoutes } from "./query";
import { mysqlDataRoutes } from "./data";
import { mysqlUserRoutes } from "./users";
import { mysqlExportImportRoutes } from "./export-import";

export const mysqlManageRoutes = new Elysia()
  .use(mysqlConnectionRoutes)
  .use(mysqlQueryRoutes)
  .use(mysqlDataRoutes)
  .use(mysqlUserRoutes)
  .use(mysqlExportImportRoutes);