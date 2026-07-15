import { router } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { partsRouter } from "./routers/parts.js";
import { sheetsRouter } from "./routers/sheets.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { exportsRouter } from "./routers/exports.js";
import { documentsRouter } from "./routers/documents.js";
import { changeOrdersRouter } from "./routers/changeOrders.js";
import { signaturesRouter } from "./routers/signatures.js";
import { googleRouter } from "./routers/google.js";
import { filesRouter } from "./routers/files.js";
import { workOrdersRouter } from "./routers/workOrders.js";
import { recordsRouter } from "./routers/records.js";
import { ncRouter } from "./routers/nc.js";
import { capaRouter } from "./routers/capa.js";
import { routingsRouter } from "./routers/routings.js";

export const appRouter = router({
  auth: authRouter,
  parts: partsRouter,
  sheets: sheetsRouter,
  dashboard: dashboardRouter,
  exports: exportsRouter,
  documents: documentsRouter,
  changeOrders: changeOrdersRouter,
  signatures: signaturesRouter,
  google: googleRouter,
  files: filesRouter,
  workOrders: workOrdersRouter,
  records: recordsRouter,
  nc: ncRouter,
  capa: capaRouter,
  routings: routingsRouter,
});

export type AppRouter = typeof appRouter;
