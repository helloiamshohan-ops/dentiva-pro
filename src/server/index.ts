import path from "node:path";
import { DentivaApp, defaultDataDir } from "../core/app.ts";
import { createApiServer } from "./http.ts";

const dataDir = process.env.DENTIVA_DATA_DIR || defaultDataDir();
const port = Number(process.env.DENTIVA_API_PORT || 4780);
const host = process.env.DENTIVA_API_HOST || "0.0.0.0";

const app = new DentivaApp(dataDir);
createApiServer(app, host, port);

process.stdout.write(`Dentiva Pro API listening on http://${host}:${port}\n`);
process.stdout.write(`Data directory: ${path.resolve(dataDir)}\n`);
