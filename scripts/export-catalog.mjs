import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogGames } from "../lib/db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "data", "catalog-normalized.json");
const { games, generatedAt } = await loadCatalogGames([]);
const payload = { generatedAt, games };
await fs.writeFile(target, JSON.stringify(payload), "utf8");
const stats = await fs.stat(target);
console.log(`games=${games.length} bytes=${stats.size}`);
