import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../apps/api/src/server/api/routes.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = join(scriptDir, "../apps/api/openapi.json");

const document = buildOpenApiDocument();
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");