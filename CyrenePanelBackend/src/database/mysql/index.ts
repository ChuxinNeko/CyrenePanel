import { Elysia } from "elysia";
import { mysqlConnectionRoutes } from "./connections";
import { mysqlQueryRoutes } from "./query";
import { mysqlDataRoutes } from "./data";
import { mysqlUserRoutes } from "./users";
import { mysqlExportImportRoutes } from "./export-import";
import { mysqlStatusRoutes } from "./status";
import { mysqlMaintenanceRoutes } from "./maintenance";
import { mysqlBackupRoutes } from "./backup";

export const mysqlManageRoutes = new Elysia()
  .use(mysqlConnectionRoutes)
  .use(mysqlQueryRoutes)
  .use(mysqlDataRoutes)
  .use(mysqlUserRoutes)
  .use(mysqlExportImportRoutes)
  .use(mysqlStatusRoutes)
  .use(mysqlMaintenanceRoutes)
  .use(mysqlBackupRoutes);
