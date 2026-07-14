import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { TRPCError } from "@trpc/server";
import { appRouter } from "./root.js";
import { createContext } from "./trpc.js";

const PORT = Number(process.env.PORT ?? 4000);

const corsOrigins = (process.env.CORS_ORIGINS ??
  "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function main() {
  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet);

  await app.register(cors, {
    origin: corsOrigins,
    credentials: false,
  });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }: { path?: string; error: TRPCError }) {
        // eslint-disable-next-line no-console
        console.error(`[trpc] ${path ?? "<no-path>"}:`, error);
      },
    },
  });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`DataSheets API listening on :${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
