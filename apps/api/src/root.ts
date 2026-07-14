import { router } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { partsRouter } from "./routers/parts.js";
import { sheetsRouter } from "./routers/sheets.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { exportsRouter } from "./routers/exports.js";

export const appRouter = router({
  auth: authRouter,
  parts: partsRouter,
  sheets: sheetsRouter,
  dashboard: dashboardRouter,
  exports: exportsRouter,
});

export type AppRouter = typeof appRouter;
