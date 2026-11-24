import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function resolveDesktopDir() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const oneDriveDesktop = path.join(userProfile, "OneDrive", "Desktop");
  if (userProfile && fs.existsSync(oneDriveDesktop)) return oneDriveDesktop;
  return path.join(userProfile, "Desktop");
}

export const ROOT_DIR = path.resolve(here, "..");
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, "data");
export const PORT = Number.parseInt(process.env.PORT || "4000", 10);
export const HOST = process.env.HOST || "0.0.0.0";
export const UPDATES_DIR = process.env.MKZEIRA_UPDATES_DIR
  ? path.resolve(process.env.MKZEIRA_UPDATES_DIR)
  : path.join(resolveDesktopDir(), "Mkzeira - Updates");
fs.mkdirSync(UPDATES_DIR, { recursive: true });
export const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
export const DEMO_USERNAME = process.env.DEMO_USERNAME || "mkzeira";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "mkzeira";
export const APP_VERSION = "1.0.0";
export const CATALOG_BASE_URL = (
  process.env.MKZEIRA_CATALOG_BASE_URL ||
  "https://raw.githubusercontent.com/mkzeira/mkzeira_catalogos/main"
).replace(/\/$/, "");
export const CATALOG_GAMES_FILE =
  process.env.MKZEIRA_CATALOG_GAMES_FILE || "catalogo-steam-jogos.json";
export const CATALOG_LOCAL_FILE =
  process.env.MKZEIRA_CATALOG_LOCAL_FILE || "catalogo-mkzeira-local.json";
export const CATALOG_INFO_FILE =
  process.env.MKZEIRA_CATALOG_INFO_FILE || "catalogo-info.json";
export const CATALOG_REFRESH_MS = Number.parseInt(
  process.env.MKZEIRA_CATALOG_REFRESH_MS || "21600000",
  10
);
