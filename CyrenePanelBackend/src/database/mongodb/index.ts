import { Elysia } from "elysia";

import { mongoConnectionRoutes } from "./connections";
import { mongoBrowseRoutes } from "./browse";
import { mongoStatusRoutes } from "./status";

export const mongoManageRoutes = new Elysia()
  .use(mongoConnectionRoutes)
  .use(mongoBrowseRoutes)
  .use(mongoStatusRoutes);
