import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { TRPCError } from "@trpc/server";
import { appRouter } from "./root.js";
import { createContext } from "./trpc.js";

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
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
