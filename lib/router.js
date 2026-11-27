import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bearer,
  getRequestUrl,
  readJson,
  sendEmpty,
  sendHtml,
  sendJavaScript,
  sendJson,
  withCors,
} from "./http.js";
import {
  createSession,
  hashPassword,
  isValidCode,
  normalizeCode,
  signToken,
  verifyPassword,
  verifyToken,
} from "./auth.js";
import { APP_VERSION, DATA_DIR, PUBLIC_URL, UPDATES_DIR } from "./config.js";
import {
  createUser,
  enrichGamesWithAssets,
  findGame,
  getCatalogImageStats,
  publicUser,
  saveDb,
  toShopAssets,
} from "./db.js";
import { renderAuthPage, renderCloudPage } from "./html.js";

const LOGIN_ICON_FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#4c1d95"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/><circle cx="96" cy="32" r="30" fill="#a78bfa" opacity=".35"/><text x="64" y="81" text-anchor="middle" font-family="Arial,sans-serif" font-size="62" font-weight="700" fill="#f5f3ff">M</text></svg>`;

const FEATURE_FLAGS = [
  "CHECK_DOWNLOAD_WRITE_PERMISSION",
  "TORBOX",
  "ALLDEBRID",
  "PREMIUMIZE",
  "CHAT_MODERATION",
  "CHAT_IMAGES",
  "SCREENSHOTS",
  "SCREENSHOT_COMMENTS",
  "TURNSTILE_SIGN_IN",
  "TURNSTILE_SIGN_UP",
  "TURNSTILE_USERNAME_CHECK",
  "TURNSTILE_RECOVER_ACCOUNT",
  "TURNSTILE_RESET_PASSWORD",
  "TURNSTILE_UPDATE_EMAIL",
  "TURNSTILE_UPDATE_PASSWORD",
  "TURNSTILE_DELETE_ACCOUNT",
  "IN_PLACE_ARCHIVE_EXTRACTION",
  "GLOBAL_LEADERBOARDS",
  "GAME_LEADERBOARDS_EXTENDED",
  "MULTIPART_HOSTER_DOWNLOADS",
  "RECOMPILATIONS",
  "RECOMPILATION_CLOUD_SAVES",
  "LEADERBOARD_WRITES",
  "LEADERBOARD_REPORTS",
  "NEO_DISCORD_APPROVED",
  "NEO_DISCORD_CLOUD",
];

const LEADERBOARD_METRICS = [
  { id: "playtime", label: "Playtime", valueType: "duration" },
  { id: "games", label: "Games played", valueType: "count" },
  { id: "achievements", label: "Achievements", valueType: "count" },
  { id: "streak", label: "Play streak", valueType: "count" },
];

function emptyLeaderboard() {
  const now = new Date().toISOString();
  return {
    entries: [],
    viewer: null,
    total: 0,
    weekStart: now,
    weekEnd: now,
    periodStart: now,
    periodEnd: now,
  };
}

function toPlainText(value) {
  if (!value) return null;
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/(p|div|li)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function ok(body, status = 200) {
  return { status, body };
}

function fail(status, message, code = "REQUEST_FAILED") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parseBirthDate({ birthYear, birthMonth, birthDay }) {
  const year = Number(birthYear);
  const month = Number(birthMonth);
  const day = Number(birthDay);

  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) {
    return null;
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseGender(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["homem", "male", "masculino"].includes(normalized)) return "homem";
  if (["mulher", "female", "feminino"].includes(normalized)) return "mulher";
  return null;
}

function usernameFromEmail(db, email) {
  const base = String(email)
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24) || "usuario";

  let username = base;
  let suffix = 1;
  while (db.users.some((user) => user.username === username)) {
    username = `${base}${suffix}`;
    suffix += 1;
  }
  return username;
}

function issueAuth(ctx, user, sessionId = null, status = 200) {
  if (!ctx.db.sessions) ctx.db.sessions = {};
  const session = createSession(user, sessionId, (code) =>
    Object.values(ctx.db.sessions).some((entry) => entry.sessionId === code)
  );

  ctx.db.sessions[session.refreshToken] = {
    userId: user.id,
    sessionId: session.sessionId,
    createdAt: Date.now(),
    expiresAt: session.expiresAt,
  };
  ctx.persist();

  const { expiresAt, ...tokens } = session;
  return ok({ ...tokens, user: publicUser(user) }, status);
}

function findSessionByCode(ctx, code) {
  const sessions = ctx.db.sessions || {};
  let changed = false;

  for (const [refreshToken, session] of Object.entries(sessions)) {
    if (session.sessionId !== code) continue;
    if (session.expiresAt < Date.now()) {
      delete sessions[refreshToken];
      changed = true;
      continue;
    }
    if (changed) ctx.persist();
    return session;
  }
  if (changed) ctx.persist();
  return null;
}

const DOWNLOAD_SOURCE_STATUS = {
  matched: "MATCHED",
  failed: "FAILED",
};

function queryValues(url, key) {
  const values = [];
  for (const [name, value] of url.searchParams.entries()) {
    if (name !== key && name !== `${key}[]`) continue;
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        for (const item of JSON.parse(trimmed)) values.push(String(item));
        continue;
      } catch {
        values.push(trimmed);
        continue;
      }
    }
    values.push(trimmed);
  }
  return values;
}

function updatesContentType(fileName) {
  const types = {
    ".json": "application/json; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".blockmap": "application/json; charset=utf-8",
    ".exe": "application/octet-stream",
    ".msi": "application/octet-stream",
    ".zip": "application/zip",
  };
  return types[path.extname(fileName).toLowerCase()] || "application/octet-stream";
}

function sourceFingerprint(url) {
  return createHash("sha1").update(String(url).trim()).digest("hex").slice(0, 16);
}

function normalizeSourceUrl(value) {
  let raw = String(value || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && raw.includes(".")) {
    raw = `https://${raw}`;
  }
  try {
    return new URL(raw).toString();
  } catch {
    return raw;
  }
}

const hydraMirrorHosts = new Set([
  "hydralinks.cloud",
  "www.hydralinks.cloud",
  "hydralinks.pages.dev",
  "www.hydralinks.pages.dev",
]);

function resolveSourceFetchUrls(url) {
  try {
    const parsedUrl = new URL(url);
    if (!hydraMirrorHosts.has(parsedUrl.hostname.toLowerCase())) return [url];
    const sourceName = path.basename(
      parsedUrl.pathname,
      path.extname(parsedUrl.pathname)
    );
    if (!/^[a-z0-9-]+$/i.test(sourceName)) return [url];
    return [
      `https://raw.githubusercontent.com/ArnamentGames/HydraLinks/main/${sourceName}.json`,
      `https://cdn.jsdelivr.net/gh/ArnamentGames/HydraLinks@main/${sourceName}.json`,
    ];
  } catch {
    return [url];
  }
}

async function readDownloadSourcePayload(url) {
  const normalizedUrl = String(url || "").trim();
  const parsedUrl = new URL(normalizedUrl);

  if (parsedUrl.protocol === "file:") {
    return fs.readFile(fileURLToPath(parsedUrl), "utf8");
  }

  let lastError;
  for (const fetchUrl of resolveSourceFetchUrls(normalizedUrl)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(fetchUrl, {
          headers: {
            accept: "application/json,text/plain,*/*",
            "user-agent": "Mkzeira-Server/1.0",
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } catch (error) {
        lastError = new Error(`${fetchUrl}: ${error.message}`);
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  }
  throw lastError || new Error("Falha ao carregar fonte");
}

function inferSourceName(url, payload) {
  const candidate = [payload?.name, payload?.sourceName, payload?.title].find(
    (value) => typeof value === "string" && value.trim()
  );
  if (candidate) return candidate.trim();

  try {
    const parsedUrl = new URL(String(url));
    const baseName = path.basename(
      parsedUrl.pathname,
      path.extname(parsedUrl.pathname)
    );
    return baseName || parsedUrl.hostname || "Fonte local";
  } catch {
    return "Fonte local";
  }
}

function sourceEntries(payload) {
  if (Array.isArray(payload)) return payload;
  for (const container of [payload, payload?.data, payload?.result]) {
    if (!container || typeof container !== "object") continue;
    for (const key of [
      "games",
      "repacks",
      "items",
      "results",
      "entries",
      "downloads",
    ]) {
      if (Array.isArray(container[key])) return container[key];
    }
  }
  return [];
}

function normalizeGameTitle(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value) {
  return normalizeGameTitle(value)
    .split(" ")
    .filter((token) => token.length > 1 || /\d/.test(token));
}

function buildGameSearchIndex(db) {
  const byObjectId = new Map();
  const byObjectIdOnly = new Map();
  const byExactTitle = new Map();
  const byToken = new Map();

  for (const game of Array.isArray(db.games) ? db.games : []) {
    if (!game) continue;

    const objectKey = `${game.shop}:${game.objectId}`;
    if (!byObjectId.has(objectKey)) byObjectId.set(objectKey, game);
    if (game.objectId && !byObjectIdOnly.has(String(game.objectId))) {
      byObjectIdOnly.set(String(game.objectId), game);
    }

    const normalizedTitle = normalizeGameTitle(game.title ?? game.name);
    if (!normalizedTitle) continue;
    if (!byExactTitle.has(normalizedTitle)) {
      byExactTitle.set(normalizedTitle, game);
    }

    for (const token of new Set(titleTokens(normalizedTitle))) {
      let candidates = byToken.get(token);
      if (!candidates) {
        candidates = [];
        byToken.set(token, candidates);
      }
      if (candidates.length < 300 && !candidates.includes(game)) {
        candidates.push(game);
      }
    }
  }

  return { byObjectId, byObjectIdOnly, byExactTitle, byToken };
}

function scoreTitleMatch(entryTitle, gameTitle) {
  const entry = normalizeGameTitle(entryTitle);
  const game = normalizeGameTitle(gameTitle);
  if (!entry || !game) return 0;
  if (entry === game) return 1;
  if (entry.length >= 4 && game.includes(entry)) return 0.96;
  if (game.length >= 4 && entry.includes(game)) {
    return Math.max(0.82, 0.96 - (entry.length - game.length) * 0.002);
  }

  const entryTokens = new Set(titleTokens(entry));
  const gameTokens = new Set(titleTokens(game));
  if (!entryTokens.size || !gameTokens.size) return 0;

  const commonTokens = [...entryTokens].filter((token) => gameTokens.has(token));
  if (!commonTokens.length) return 0;

  const union = new Set([...entryTokens, ...gameTokens]).size;
  const jaccard = commonTokens.length / union;
  const overlap = commonTokens.length / Math.min(entryTokens.size, gameTokens.size);
  return Math.max(jaccard, overlap * 0.92);
}

function findMatchingGame(entry, index) {
  const objectId = String(
    entry.objectId ??
      entry.objectID ??
      entry.appid ??
      entry.appId ??
      entry.gameId ??
      entry.steamAppId ??
      ""
  ).trim();
  const shop = String(entry.shop ?? "steam").trim().toLowerCase() || "steam";

  if (objectId) {
    const byShop = index.byObjectId.get(`${shop}:${objectId}`);
    if (byShop) return byShop;
    const byId = index.byObjectIdOnly.get(objectId);
    if (byId) return byId;
  }

  const title = String(entry.title ?? entry.name ?? entry.gameTitle ?? "");
  const normalizedTitle = normalizeGameTitle(title);
  if (!normalizedTitle) return null;

  const exact = index.byExactTitle.get(normalizedTitle);
  if (exact) return exact;

  const candidates = new Set();
  for (const token of new Set(titleTokens(title))) {
    for (const game of index.byToken.get(token) || []) candidates.add(game);
  }

  let best = null;
  let bestScore = 0;
  for (const game of candidates) {
    const score = scoreTitleMatch(title, game.title ?? game.name);
    if (score > bestScore) {
      best = game;
      bestScore = score;
    }
  }

  return bestScore >= 0.72 ? best : null;
}

function uriList(entry) {
  const values = [
    entry.uris,
    entry.urls,
    entry.links,
    entry.magnets,
    entry.uri,
    entry.url,
    entry.link,
    entry.downloadUrl,
    entry.magnet,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map((value) => String(value).trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function normalizeDownloadRepacks(payload, source, gameIndex, now) {
  return sourceEntries(payload)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;

      const title = String(
        entry.title ?? entry.name ?? entry.gameTitle ?? ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const objectId = String(
        entry.objectId ??
          entry.objectID ??
          entry.appid ??
          entry.appId ??
          entry.gameId ??
          entry.steamAppId ??
          ""
      ).trim();
      const shop = String(entry.shop ?? "steam").trim().toLowerCase() || "steam";
      const game = findMatchingGame(entry, gameIndex);
      const uris = uriList(entry);
      if (!game || uris.length === 0) return null;

      const resolvedShop = game.shop || shop;
      const resolvedObjectId = String(game.objectId || objectId);
      const fileSize = entry.fileSize ?? entry.size ?? game.fileSize ?? null;
      const uploadDate = entry.uploadDate ?? entry.createdAt ?? entry.date ?? now;
      const createdAt = entry.createdAt ?? uploadDate ?? now;

      return {
        id: `${source.id}-${index}-${createHash("sha1")
          .update(`${resolvedShop}:${resolvedObjectId}:${uris.join("|")}`)
          .digest("hex")
          .slice(0, 10)}`,
        shop: resolvedShop,
        objectId: resolvedObjectId,
        title: title || game.title,
        fileSize:
          fileSize === null || fileSize === "" ? null : String(fileSize).trim(),
        uris,
        uriGroups: Array.isArray(entry.uriGroups) ? entry.uriGroups : [uris],
        unavailableUris: [],
        uploadDate: String(uploadDate),
        downloadSourceId: source.id,
        downloadSourceName: source.name,
        createdAt: String(createdAt),
      };
    })
    .filter(Boolean);
}

function ensureDownloadSourceRepacks(db) {
  if (!Array.isArray(db.downloadSourceRepacks)) db.downloadSourceRepacks = [];
  return db.downloadSourceRepacks;
}

async function refreshDownloadSource(source, db, gameIndex) {
  const payloadText = await readDownloadSourcePayload(source.url);
  let payload;
  try {
    payload = JSON.parse(payloadText.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error("JSON inválido");
  }
  const name = inferSourceName(source.url, payload);
  source.name = name;
  source.fingerprint = source.fingerprint || sourceFingerprint(source.url);
  source.status = DOWNLOAD_SOURCE_STATUS.matched;

  const repacks = normalizeDownloadRepacks(
    payload,
    { ...source, name },
    gameIndex || buildGameSearchIndex(db),
    new Date().toISOString()
  );
  source.downloadCount = repacks.length;

  const cache = ensureDownloadSourceRepacks(db);
  db.downloadSourceRepacks = [
    ...cache.filter((repack) => repack.downloadSourceId !== source.id),
    ...repacks,
  ];
  return repacks;
}

export async function refreshAllDownloadSources(db, ctx) {
  if (!Array.isArray(db.downloadSources)) db.downloadSources = [];
  const gameIndex = buildGameSearchIndex(db);
  for (const source of db.downloadSources) {
    try {
      await refreshDownloadSource(source, db, gameIndex);
    } catch (error) {
      source.status = DOWNLOAD_SOURCE_STATUS.failed;
      source.downloadCount = 0;
      console.error(`[download-sources] falha ao sincronizar ${source.url}: ${error.message}`);
    }
  }
  ctx.persist();
  return db.downloadSources;
}

function match(pattern, pathname) {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;

  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(":")) {
      params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    } else if (expected[index] !== actual[index]) {
      return null;
    }
  }
  return params;
}

function requireUser(req, db) {
  const claims = verifyToken(bearer(req));
  if (!claims || claims.type !== "access") {
    throw fail(401, "Não autenticado", "UNAUTHORIZED");
  }

  const user = db.users.find((candidate) => candidate.id === claims.sub);
  if (!user) throw fail(401, "Usuário não encontrado", "UNAUTHORIZED");
  return user;
}

function paginate(url, items) {
  const take = Number.parseInt(url.searchParams.get("take") || "", 10);
  const skip = Number.parseInt(url.searchParams.get("skip") || "", 10);
  const start = Number.isFinite(skip) && skip >= 0 ? skip : 0;
  const limit = Number.isFinite(take) && take > 0 ? take : items.length;
  return items.slice(start, start + limit);
}

function paginationNumber(url, body, key) {
  const fromUrl = url.searchParams.get(key);
  let raw = fromUrl !== null ? fromUrl : body?.[key];
  if (raw === undefined || raw === null) raw = body?.data?.[key];
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) ? value : null;
}

function paginateCatalogue(url, items, body = {}) {
  const takeValue = paginationNumber(url, body, "take");
  const limit = takeValue !== null && takeValue > 0 ? Math.min(takeValue, 100) : 24;

  let skip = paginationNumber(url, body, "skip");
  if (skip === null) {
    const page = paginationNumber(url, body, "page");
    if (page !== null) skip = Math.max(0, page - 1) * limit;
  }

  const start = skip !== null && skip >= 0 ? skip : 0;
  return items.slice(start, start + limit);
}

function catalogueMeta(db, ctx) {
  if (ctx?.catalogMeta) return ctx.catalogMeta;
  const genres = new Set();
  const tags = {};
  const developers = new Set();
  const publishers = new Set();
  for (const game of db.games) {
    for (const genre of game.genres || []) genres.add(genre);
    for (const [name, count] of Object.entries(game.tags || {})) {
      tags[name] = (tags[name] || 0) + count;
    }
    if (game.developer) developers.add(game.developer);
    if (game.publisher) publishers.add(game.publisher);
  }
  return {
    genres: [...genres],
    tags,
    developers: [...developers],
    publishers: [...publishers],
  };
}

function toShopDetails(game) {
  if (!game) return null;

  const description =
    game.description ||
    `<p>${game.title} — jogo disponível no catálogo Mkzeira.</p>`;

  return {
    objectId: game.objectId,
    shop: game.shop,
    name: game.title,
    title: game.title,
    type: "game",
    detailed_description: description,
    short_description: description,
    about_the_game: description,
    supported_languages: "Portuguese, English",
    header_image: game.libraryHeroImageUrl,
    background: game.coverImageUrl,
    developers: [game.developer],
    publishers: [game.publisher],
    release_date: { date: game.releaseDate, coming_soon: false },
    genres: game.genres.map((name) => ({ id: name, description: name })),
    screenshots: [{ id: "0", path_full: game.coverImageUrl }],
    platform: "windows",
    skus: [],
    retroAchievementsGameId: null,
    descriptionLanguage: "pt-BR",
    pc_requirements: game.pcRequirements || { minimum: "", recommended: "" },
    mac_requirements: game.macRequirements || { minimum: "", recommended: "" },
    linux_requirements: game.linuxRequirements || { minimum: "", recommended: "" },
  };
}

function toLaunchboxShopDetails(game) {
  if (!game) return null;

  const description =
    game.description ||
    `<p>${game.title} — jogo disponível no catálogo Mkzeira.</p>`;

  return {
    title: game.title,
    description,
    releaseDate: game.releaseDate || null,
    developers: game.developer ? [game.developer] : [],
    publishers: game.publisher ? [game.publisher] : [],
    genres: game.genres || [],
    headerImage: game.libraryHeroImageUrl || null,
    website: null,
    screenshots: game.coverImageUrl ? [game.coverImageUrl] : [],
    platform: "windows",
    pcRequirements: game.pcRequirements || { minimum: "", recommended: "" },
    macRequirements: game.macRequirements || { minimum: "", recommended: "" },
    linuxRequirements: game.linuxRequirements || { minimum: "", recommended: "" },
    assets: {
      objectId: game.objectId,
      shop: game.shop,
      title: game.title,
      iconUrl: game.iconUrl || null,
      libraryHeroImageUrl: game.libraryHeroImageUrl || null,
      libraryImageUrl: game.libraryImageUrl || null,
      logoImageUrl: game.logoImageUrl || null,
    },
  };
}

function toTrending(game) {
  return {
    ...toShopAssets(game),
    description: toPlainText(game.description)?.slice(0, 240) || null,
    uri: game.uri,
  };
}

function normalizeVisibility(value) {
  const normalized = String(value ?? "public").toUpperCase();
  return ["PUBLIC", "PRIVATE", "FRIENDS"].includes(normalized)
    ? normalized
    : "PUBLIC";
}

function toProfile(user, db) {
  const friends = db?.friends ?? [];
  const subscription = user.subscription ?? null;

  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    email: user.email,
    bio: user.bio,
    profileImageUrl: user.profileImageUrl,
    backgroundImageUrl: user.backgroundImageUrl,
    profileVisibility: normalizeVisibility(user.profileVisibility),
    souvenirsVisibility: normalizeVisibility(user.souvenirsVisibility),
    screenshotsVisibility: normalizeVisibility(user.screenshotsVisibility),
    screenshotCommentsPolicy: user.screenshotCommentsPolicy ?? "everyone",
    screenshotCount: 0,
    libraryGames: [],
    recentGames: [],
    friends,
    totalFriends: friends.length,
    relation: null,
    currentGame: null,
    karma: user.karma ?? 0,
    subscription,
    hasActiveSubscription: Boolean(subscription),
    canReceiveCloudGift: user.allowCloudGifts ?? true,
    allowCloudGifts: user.allowCloudGifts ?? true,
    quirks: user.quirks ?? { backupsPerGameLimit: 5 },
    badges: [],
    badgesDetails: [],
    hasCompletedWrapped2025: false,
  };
}

function libraryOf(user) {
  if (!user) return [];
  if (!Array.isArray(user.library)) user.library = [];
  return user.library;
}

function toUserStats(db, user) {
  const library = libraryOf(user);
  const playtime = library.reduce(
    (total, game) => total + (game.playTimeInSeconds || 0),
    0
  );
  const points = library.reduce(
    (total, game) => total + (game.achievementsPointsEarnedSum || 0),
    0
  );

  return {
    libraryCount: library.length,
    friendsCount: db.friends.length,
    totalPlayTimeInSeconds: { value: playtime, topPercentile: 1 },
    achievementsPointsEarnedSum: { value: points, topPercentile: 1 },
    unlockedAchievementSum: library.reduce(
      (total, game) => total + (game.unlockedAchievementCount || 0),
      0
    ),
    userId: user?.id ?? null,
  };
}

function findLibraryEntry(user, shop, objectId) {
  return (
    libraryOf(user).find(
      (entry) => entry.shop === shop && entry.objectId === String(objectId)
    ) || null
  );
}

function makeLibraryEntry(game, body) {
  const now = new Date().toISOString();
  return {
    remoteId: `lib-${randomUUID()}`,
    objectId: String(body.objectId || game?.objectId || ""),
    shop: body.shop || game?.shop || "steam",
    title: body.title || game?.title || "Jogo",
    iconUrl: game?.iconUrl ?? null,
    libraryHeroImageUrl: game?.libraryHeroImageUrl ?? null,
    libraryImageUrl: game?.libraryImageUrl ?? null,
    logoImageUrl: game?.logoImageUrl ?? null,
    logoPosition: game?.logoPosition ?? null,
    coverImageUrl: game?.coverImageUrl ?? null,
    downloadSources: game?.downloadSources ?? [],
    playTimeInSeconds: Number(body.playTimeInSeconds || 0),
    lastTimePlayed: body.lastTimePlayed || null,
    unlockedAchievementCount: 0,
    achievementCount: 0,
    achievementsPointsEarnedSum: 0,
    hasManuallyUpdatedPlaytime: false,
    isFavorite: Boolean(body.isFavorite),
    isHiddenFromOthers: false,
    isConcealed: false,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeStoredNotification(notification) {
  const isRead = notification.isRead ?? notification.read ?? false;

  return {
    id: notification.id,
    type: notification.type || "SYSTEM",
    variables: notification.variables || {},
    pictureUrl: notification.pictureUrl || null,
    url: notification.url || null,
    isRead: Boolean(isRead),
    priority: Number(notification.priority ?? 0),
    createdAt: notification.createdAt || new Date().toISOString(),
    title: notification.title || null,
    description: notification.description || notification.body || null,
  };
}

function notificationResponse(db, url) {
  const take = Number.parseInt(url.searchParams.get("take") || "20", 10);
  const skip = Number.parseInt(url.searchParams.get("skip") || "0", 10);
  return {
    notifications: db.notifications
      .map(normalizeStoredNotification)
      .slice(skip, skip + take),
    pagination: {
      total: db.notifications.length,
      take,
      skip,
      hasMore: skip + take < db.notifications.length,
    },
  };
}

const routes = [
  {
    method: "POST",
    pattern: "/api/auth/login",
    handler: ({ body, db, ctx }) => {
      const identifier = String(
        body.username || body.email || body.identifier || ""
      )
        .trim()
        .toLowerCase();
      const user = db.users.find(
        (candidate) =>
          candidate.username.toLowerCase() === identifier ||
          String(candidate.email || "").toLowerCase() === identifier
      );

      if (!user || !verifyPassword(body.password || "", user)) {
        throw fail(401, "Usuário ou senha inválidos", "INVALID_CREDENTIALS");
      }

      return issueAuth(ctx, user);
    },
  },
  {
    method: "POST",
    pattern: "/auth/check-email",
    handler: ({ body, db }) => {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[a-z0-9._%+-]+@mkz\.com$/.test(email)) {
        throw fail(400, "Use um email no formato exemplo@mkz.com", "INVALID_EMAIL");
      }

      return ok({
        exists: db.users.some(
          (user) => String(user.email || "").toLowerCase() === email
        ),
      });
    },
  },
  {
    method: "POST",
    pattern: "/auth/create-email",
    handler: ({ body, db, ctx }) => {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[a-z0-9._%+-]+@mkz\.com$/.test(email)) {
        throw fail(400, "Use um email no formato exemplo@mkz.com", "INVALID_EMAIL");
      }

      const firstName = String(body.firstName || body.name || "").trim();
      const lastName = String(body.lastName || body.surname || "").trim();
      const displayName =
        [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0];
      const password = String(body.password || "");
      if (password.length < 6) {
        throw fail(400, "A senha deve ter pelo menos 6 caracteres", "INVALID_PASSWORD");
      }

      const hasBirthDate =
        body.birthYear !== undefined ||
        body.birthMonth !== undefined ||
        body.birthDay !== undefined;
      const birthDate = hasBirthDate ? parseBirthDate(body) : null;
      if (hasBirthDate && !birthDate) {
        throw fail(400, "Data de nascimento inválida", "INVALID_BIRTH_DATE");
      }

      const gender = body.gender ? parseGender(body.gender) : null;
      if (body.gender && !gender) {
        throw fail(400, "Escolha homem ou mulher", "INVALID_GENDER");
      }

      if (db.users.some((user) => String(user.email || "").toLowerCase() === email)) {
        throw fail(409, "Email já cadastrado", "EMAIL_TAKEN");
      }

      const user = createUser(db, {
        username: usernameFromEmail(db, email),
        email,
        displayName,
        birthDate,
        gender,
      });
      Object.assign(user, hashPassword(password));

      return issueAuth(ctx, user, null, 201);
    },
  },
  {
    method: "POST",
    pattern: "/auth/session/login",
    handler: ({ body, db, ctx }) => {
      const code = normalizeCode(body.sessionId);
      if (!isValidCode(code)) {
        throw fail(400, "ID de sessão deve ter 9 caracteres", "INVALID_SESSION_ID");
      }

      const session = findSessionByCode(ctx, code);
      if (!session) {
        throw fail(401, "ID de sessão inválido ou expirado", "INVALID_SESSION_ID");
      }

      const user = db.users.find((candidate) => candidate.id === session.userId);
      if (!user) throw fail(401, "Usuário não encontrado", "UNAUTHORIZED");

      return issueAuth(ctx, user, code);
    },
  },
  {
    method: "POST",
    pattern: "/auth/refresh",
    handler: ({ body, req, db, ctx }) => {
      const token = body.refreshToken || bearer(req);
      const claims = verifyToken(token);
      if (!claims || claims.type !== "refresh") {
        throw fail(401, "Refresh token inválido", "INVALID_REFRESH_TOKEN");
      }

      const session = ctx.db.sessions?.[token];
      if (session && session.expiresAt < Date.now()) {
        delete ctx.db.sessions[token];
        ctx.persist();
        throw fail(401, "Refresh token expirado", "INVALID_REFRESH_TOKEN");
      }

      const user = db.users.find((candidate) => candidate.id === claims.sub);
      if (!user) throw fail(401, "Usuário não encontrado", "UNAUTHORIZED");

      const sessionId = session?.sessionId || claims.sessionId || "";
      return ok({
        accessToken: signToken(
          {
            sub: user.id,
            userId: user.id,
            sessionId,
            sessionHash: sessionId,
            type: "access",
          },
          60 * 60
        ),
        expiresIn: 60 * 60,
        sessionId,
      });
    },
  },
  {
    method: "POST",
    pattern: "/auth/logout",
    handler: ({ body, ctx }) => {
      const token = body.refreshToken;
      if (token && ctx.db.sessions?.[token]) {
        delete ctx.db.sessions[token];
        ctx.persist();
      }
      return ok({});
    },
  },
  {
    method: "POST",
    pattern: "/auth/payment",
    auth: true,
    handler: ({ user }) =>
      ok({ accessToken: signToken({ sub: user.id, type: "payment" }, 60 * 10) }),
  },
  {
    method: "POST",
    pattern: "/auth/realtime",
    auth: true,
    handler: ({ user }) =>
      ok({
        token: signToken({ sub: user.id, type: "realtime" }, 60 * 60),
        url: `${PUBLIC_URL.replace(/^http/, "ws")}/realtime`,
        expiresIn: 60 * 60,
      }),
  },
  {
    method: "GET",
    pattern: "/features",
    handler: () => ok(FEATURE_FLAGS),
  },
  {
    method: "GET",
    pattern: "/decky/release",
    handler: () =>
      ok({ version: "0.0.0", downloadUrl: `${PUBLIC_URL}/decky-plugin.zip` }),
  },
  {
    method: "GET",
    pattern: "/badges",
    handler: () => ok([]),
  },
  {
    method: "GET",
    pattern: "/leaderboards/metrics",
    handler: () => ok({ metrics: LEADERBOARD_METRICS }),
  },
  {
    method: "GET",
    pattern: "/leaderboards/:metric",
    handler: () => ok(emptyLeaderboard()),
  },
  {
    method: "GET",
    pattern: "/catalogue/hot",
    handler: async ({ db, url }) =>
      ok(await enrichGamesWithAssets(paginateCatalogue(url, db.games))),
  },
  {
    method: "GET",
    pattern: "/catalogue/weekly",
    handler: async ({ db, url }) =>
      ok(await enrichGamesWithAssets(paginateCatalogue(url, db.games))),
  },
  {
    method: "GET",
    pattern: "/catalogue/achievements",
    handler: async ({ db, url }) =>
      ok(await enrichGamesWithAssets(paginateCatalogue(url, db.games))),
  },
  {
    method: "GET",
    pattern: "/catalogue/featured",
    handler: async ({ db, url }) => {
      const games = await enrichGamesWithAssets(
        paginateCatalogue(url, db.games.slice(0, 12))
      );
      return ok(games.map(toTrending));
    },
  },
  {
    method: "GET",
    pattern: "/catalogue/steam/genres",
    handler: ({ db, ctx }) => ok(catalogueMeta(db, ctx).genres),
  },
  {
    method: "GET",
    pattern: "/catalogue/steam/tags",
    handler: ({ db, ctx }) => ok(catalogueMeta(db, ctx).tags),
  },
  {
    method: "GET",
    pattern: "/catalogue/steam/developers",
    handler: ({ db, ctx }) => ok(catalogueMeta(db, ctx).developers),
  },
  {
    method: "GET",
    pattern: "/catalogue/steam/publishers",
    handler: ({ db, ctx }) => ok(catalogueMeta(db, ctx).publishers),
  },
  {
    method: "GET",
    pattern: "/catalogue/steam/executables",
    handler: () => ok([]),
  },
  {
    method: "GET",
    pattern: "/catalogue/filters",
    handler: ({ db, ctx }) => {
      const meta = catalogueMeta(db, ctx);
      return ok({
        shops: ["steam"],
        genres: meta.genres,
        tags: Object.keys(meta.tags),
      });
    },
  },
  {
    method: "POST",
    pattern: "/catalogue/search",
    handler: async ({ body, db, url }) => {
      const filters = body.data || body.filters || body;
      const query = String(
        filters.query ||
          filters.search ||
          filters.searchQuery ||
          body.query ||
          body.search ||
          body.searchQuery ||
          ""
      )
        .trim()
        .toLowerCase();
      let matched = db.games.filter(
        (game) => !query || game.title.toLowerCase().includes(query)
      );

      const fingerprints = (
        Array.isArray(filters.downloadSourceFingerprints)
          ? filters.downloadSourceFingerprints
          : filters.downloadSourceFingerprints
            ? [filters.downloadSourceFingerprints]
            : []
      )
        .map(String)
        .filter(Boolean);

      if (fingerprints.length) {
        const sourceIds = (db.downloadSources || [])
          .filter((source) => fingerprints.includes(source.fingerprint))
          .map((source) => source.id);
        const gameKeys = new Set(
          ensureDownloadSourceRepacks(db)
            .filter((repack) => sourceIds.includes(repack.downloadSourceId))
            .map((repack) => `${repack.shop}:${repack.objectId}`)
        );
        matched = matched.filter((game) =>
          gameKeys.has(`${game.shop}:${game.objectId}`)
        );
      }

      return ok({
        edges: await enrichGamesWithAssets(paginateCatalogue(url, matched, body)),
        count: matched.length,
      });
    },
  },
  {
    method: "GET",
    pattern: "/catalogue/search/suggestions",
    handler: async ({ db, url }) => {
      const query = String(url.searchParams.get("query") || "")
        .trim()
        .toLowerCase();
      const games = await enrichGamesWithAssets(
        db.games
          .filter((game) => !query || game.title.toLowerCase().includes(query))
          .slice(0, 8)
      );
      return ok(
        games.map((game) => ({
          title: game.title,
          objectId: game.objectId,
          shop: game.shop,
          iconUrl: game.iconUrl,
        }))
      );
    },
  },
  {
    method: "GET",
    pattern: "/catalogue/:shop/:objectId/similar",
    handler: async ({ db, params, url }) =>
      ok(
        await enrichGamesWithAssets(
          paginateCatalogue(
            url,
            db.games.filter(
              (game) =>
                game.objectId !== params.objectId ||
                game.shop !== params.shop
            )
          )
        )
      ),
  },
  {
    method: "POST",
    pattern: "/games/shop-details",
    handler: async ({ body, db }) => {
      const objectIds = Array.isArray(body.objectIds) ? body.objectIds : [];
      const games = await enrichGamesWithAssets(
        objectIds
          .map((objectId) => findGame(db, body.shop || "steam", objectId))
          .filter(Boolean)
      );
      return ok(
        games.map((game) => {
          const details = toShopDetails(game);
          return {
            ...details,
            objectId: game.objectId,
            shop: game.shop,
            data: toLaunchboxShopDetails(game),
          };
        })
      );
    },
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId",
    handler: async ({ db, params }) => {
      const game = findGame(db, params.shop, params.objectId);
      if (!game) return ok(null);
      await enrichGamesWithAssets([game]);
      return ok(game);
    },
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/shop-details",
    handler: async ({ db, params }) => {
      const game = findGame(db, params.shop, params.objectId);
      if (!game) return ok(null);
      await enrichGamesWithAssets([game]);
      return ok(toShopDetails(game));
    },
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/stats",
    handler: ({ db, params }) => {
      const game = findGame(db, params.shop, params.objectId);
      return ok(
        game
          ? {
              downloadCount: 4200 + Number(game.objectId) * 17,
              playerCount: 860 + Number(game.objectId) * 5,
              averageScore: 4.5,
              reviewCount: 128 + Number(game.objectId),
            }
          : { downloadCount: 0, playerCount: 0, averageScore: null, reviewCount: 0 }
      );
    },
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/assets",
    handler: async ({ db, params }) => {
      const game = findGame(db, params.shop, params.objectId);
      if (!game) return ok(null);
      await enrichGamesWithAssets([game]);
      return ok(toShopAssets(game));
    },
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/download-sources",
    handler: ({ db, params, url }) => {
      const requestedIds = queryValues(url, "downloadSourceIds");
      const sourceIds = requestedIds.length
        ? requestedIds
        : (db.downloadSources || []).map((source) => source.id);
      const take = Number.parseInt(url.searchParams.get("take") || "", 10);
      const skip = Number.parseInt(url.searchParams.get("skip") || "", 10);
      const repacks = ensureDownloadSourceRepacks(db).filter(
        (repack) =>
          repack.shop === params.shop &&
          repack.objectId === params.objectId &&
          sourceIds.includes(repack.downloadSourceId)
      );
      const start = Number.isFinite(skip) && skip >= 0 ? skip : 0;
      const limit = Number.isFinite(take) && take > 0 ? take : repacks.length;
      return ok(repacks.slice(start, start + limit));
    },
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/how-long-to-beat",
    handler: () => ok({ hours: 12, minutes: 0 }),
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/protondb",
    handler: () => ok({ tier: "gold", trends: [], reports: [] }),
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/screenshots",
    handler: () => ok({ items: [], nextCursor: null }),
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/reviews",
    handler: () => ok({ reviews: [], edges: [], total: 0, count: 0 }),
  },
  {
    method: "POST",
    pattern: "/games/:shop/:objectId/reviews",
    auth: true,
    handler: ({ body, params }) =>
      ok({
        id: `review-${randomUUID()}`,
        reviewHtml: String(body.reviewHtml || ""),
        score: Number(body.score || 0),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        upvotes: 0,
        downvotes: 0,
        answerCount: 0,
        answers: [],
        isBlocked: false,
        hasUpvoted: false,
        hasDownvoted: false,
        user: { id: "user-mkzeira", displayName: "Mkzeira" },
        translations: {},
        detectedLanguage: null,
        shop: params.shop,
        objectId: params.objectId,
      }),
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/reviews/check",
    auth: true,
    handler: () => ok({ canReview: true, review: null }),
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/achievements",
    handler: () => ok([]),
  },
  {
    method: "GET",
    pattern: "/games/:shop/:objectId/leaderboards/:metric",
    handler: () => ok(emptyLeaderboard()),
  },
  {
    method: "POST",
    pattern: "/hosters/availability",
    handler: ({ body }) =>
      ok({
        results: (Array.isArray(body.urls) ? body.urls : []).map((url) => ({
          url,
          available: true,
        })),
      }),
  },
  {
    method: "GET",
    pattern: "/download-sources",
    handler: ({ db }) => ok(db.downloadSources || []),
  },
  {
    method: "POST",
    pattern: "/download-sources",
    handler: async ({ body, db, ctx }) => {
      const sourceUrl = normalizeSourceUrl(body.url);
      if (!sourceUrl) throw fail(400, "URL da fonte é obrigatória", "INVALID_URL");

      if (!Array.isArray(db.downloadSources)) db.downloadSources = [];
      if (db.downloadSources.some((source) => source.url === sourceUrl)) {
        throw fail(409, "Essa fonte já foi adicionada", "SOURCE_ALREADY_EXISTS");
      }

      const source = {
        id: body.id || `source-${randomUUID()}`,
        name: body.name || "Fonte local",
        url: sourceUrl,
        status: DOWNLOAD_SOURCE_STATUS.matched,
        downloadCount: 0,
        fingerprint: sourceFingerprint(sourceUrl),
        createdAt: new Date().toISOString(),
      };
      db.downloadSources.push(source);

      try {
        await refreshDownloadSource(source, db);
      } catch (error) {
        source.status = DOWNLOAD_SOURCE_STATUS.failed;
        source.downloadCount = 0;
        console.error(`[download-sources] falha ao adicionar ${sourceUrl}: ${error.message}`);
      }

      ctx.persist();
      return ok(source, 201);
    },
  },
  {
    method: "POST",
    pattern: "/download-sources/sync",
    handler: async ({ db, ctx }) => {
      await refreshAllDownloadSources(db, ctx);
      return ok(db.downloadSources || []);
    },
  },
  {
    method: "POST",
    pattern: "/download-sources/changes",
    handler: ({ body, db }) => {
      const payload = body?.data || body || {};
      const sourceIds = (payload.downloadSourceIds || []).map(String);
      const games = Array.isArray(payload.games)
        ? payload.games
        : Array.isArray(payload.items)
          ? payload.items
          : [];
      const parsedSince = Date.parse(payload.since || 0);
      const since = Number.isFinite(parsedSince) ? parsedSince : 0;
      const repacks = ensureDownloadSourceRepacks(db);

      return ok(
        games
          .map((game) => {
            const shop = String(game?.shop || "");
            const objectId = String(game?.objectId || "");
            const newDownloadOptionsCount = repacks.filter(
              (repack) =>
                repack.shop === shop &&
                repack.objectId === objectId &&
                sourceIds.includes(repack.downloadSourceId) &&
                Date.parse(repack.createdAt || repack.uploadDate || 0) > since
            ).length;

            if (!newDownloadOptionsCount) return null;
            return {
              shop,
              objectId,
              newDownloadOptionsCount,
              downloadSourceIds: sourceIds,
            };
          })
          .filter(Boolean)
      );
    },
  },
  {
    method: "GET",
    pattern: "/profile/me",
    auth: true,
    handler: ({ user }) => ok(publicUser(user)),
  },
  {
    method: "PATCH",
    pattern: "/profile",
    auth: true,
    handler: ({ body, user, ctx }) => {
      const editable = [
        "displayName",
        "bio",
        "profileImageUrl",
        "backgroundImageUrl",
        "profileVisibility",
        "souvenirsVisibility",
        "screenshotsVisibility",
        "screenshotCommentsPolicy",
        "allowCloudGifts",
        "allowLeaderboardNotifications",
      ];
      for (const key of editable) {
        if (key in body) user[key] = body[key];
      }
      ctx.persist();
      return ok(publicUser(user));
    },
  },
  {
    method: "GET",
    pattern: "/profile/games",
    auth: true,
    handler: ({ user, url }) => ok(paginate(url, libraryOf(user))),
  },
  {
    method: "GET",
    pattern: "/profile/games/hidden",
    auth: true,
    handler: () => ok([]),
  },
  {
    method: "POST",
    pattern: "/profile/games",
    auth: true,
    handler: ({ body, db, user, ctx }) => {
      const game = findGame(db, body.shop || "steam", body.objectId);
      const entry = makeLibraryEntry(game, body);
      libraryOf(user).push(entry);
      ctx.persist();
      return ok(entry, 201);
    },
  },
  {
    method: "POST",
    pattern: "/profile/games/batch",
    auth: true,
    handler: ({ body, user, ctx }) => {
      const incoming = Array.isArray(body)
        ? body
        : Array.isArray(body.games)
          ? body.games
          : [];
      const library = libraryOf(user);
      for (const item of incoming) {
        if (!findLibraryEntry(user, item.shop || "steam", item.objectId)) {
          library.push(makeLibraryEntry(null, item));
        }
      }
      ctx.persist();
      return ok({});
    },
  },
  {
    method: "DELETE",
    pattern: "/profile/games/:remoteId",
    auth: true,
    handler: ({ user, params, ctx }) => {
      user.library = libraryOf(user).filter(
        (entry) => entry.remoteId !== params.remoteId
      );
      ctx.persist();
      return ok({});
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId",
    auth: true,
    handler: ({ body, user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (!entry) throw fail(404, "Jogo não está na biblioteca", "NOT_FOUND");
      if (body.playTimeDeltaInSeconds) {
        entry.playTimeInSeconds += Number(body.playTimeDeltaInSeconds);
      }
      if (body.lastTimePlayed) entry.lastTimePlayed = body.lastTimePlayed;
      entry.updatedAt = new Date().toISOString();
      ctx.persist();
      return ok(entry);
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId/playtime",
    auth: true,
    handler: ({ body, user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (!entry) throw fail(404, "Jogo não está na biblioteca", "NOT_FOUND");
      entry.playTimeInSeconds = Number(body.playTimeInSeconds || 0);
      entry.hasManuallyUpdatedPlaytime = true;
      entry.updatedAt = new Date().toISOString();
      ctx.persist();
      return ok(entry);
    },
  },
  {
    method: "DELETE",
    pattern: "/profile/games/:shop/:objectId/playtime",
    auth: true,
    handler: ({ user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (!entry) throw fail(404, "Jogo não está na biblioteca", "NOT_FOUND");
      entry.playTimeInSeconds = 0;
      entry.hasManuallyUpdatedPlaytime = true;
      ctx.persist();
      return ok(entry);
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId/pin",
    auth: true,
    handler: ({ user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (entry) {
        entry.isPinned = true;
        ctx.persist();
      }
      return ok(entry || {});
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId/unpin",
    auth: true,
    handler: ({ user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (entry) {
        entry.isPinned = false;
        ctx.persist();
      }
      return ok(entry || {});
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId/favorite",
    auth: true,
    handler: ({ user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (entry) {
        entry.isFavorite = true;
        ctx.persist();
      }
      return ok(entry || {});
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId/unfavorite",
    auth: true,
    handler: ({ user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (entry) {
        entry.isFavorite = false;
        ctx.persist();
      }
      return ok(entry || {});
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/:shop/:objectId/collection",
    auth: true,
    handler: ({ body, user, params, ctx }) => {
      const entry = findLibraryEntry(user, params.shop, params.objectId);
      if (entry) {
        entry.collectionId = body.collectionId || null;
        ctx.persist();
      }
      return ok(entry || {});
    },
  },
  {
    method: "GET",
    pattern: "/profile/games/collections",
    auth: true,
    handler: ({ db }) => ok(db.collections),
  },
  {
    method: "POST",
    pattern: "/profile/games/collections",
    auth: true,
    handler: ({ body, db, ctx }) => {
      const collection = {
        id: body.id || `collection-${randomUUID()}`,
        name: body.name || "Nova coleção",
        gameIds: Array.isArray(body.gameIds) ? body.gameIds : [],
      };
      db.collections.push(collection);
      ctx.persist();
      return ok(collection, 201);
    },
  },
  {
    method: "PUT",
    pattern: "/profile/games/collections/:id",
    auth: true,
    handler: ({ body, db, params, ctx }) => {
      const collection = db.collections.find((item) => item.id === params.id);
      if (collection) {
        collection.name = body.name || collection.name;
        ctx.persist();
      }
      return ok(collection || {});
    },
  },
  {
    method: "DELETE",
    pattern: "/profile/games/collections/:id",
    auth: true,
    handler: ({ db, params, ctx }) => {
      db.collections = db.collections.filter((item) => item.id !== params.id);
      ctx.persist();
      return ok({});
    },
  },
  {
    method: "GET",
    pattern: "/profile/download-sources",
    auth: true,
    handler: ({ db }) => ok(db.downloadSources || []),
  },
  {
    method: "POST",
    pattern: "/profile/download-sources",
    handler: async ({ body, db, ctx }) => {
      const urls = Array.isArray(body.urls)
        ? body.urls
        : body.url
          ? [body.url]
          : [];
      if (!Array.isArray(db.downloadSources)) db.downloadSources = [];
      const added = [];

      for (const rawUrl of urls) {
        const sourceUrl = normalizeSourceUrl(rawUrl);
        if (!sourceUrl) continue;
        if (db.downloadSources.some((source) => source.url === sourceUrl)) continue;

        const source = {
          id: body.id || `source-${randomUUID()}`,
          name: body.name || "Fonte local",
          url: sourceUrl,
          status: DOWNLOAD_SOURCE_STATUS.matched,
          downloadCount: 0,
          fingerprint: sourceFingerprint(sourceUrl),
          createdAt: new Date().toISOString(),
        };
        db.downloadSources.push(source);
        added.push(source);

        try {
          await refreshDownloadSource(source, db);
        } catch (error) {
          source.status = DOWNLOAD_SOURCE_STATUS.failed;
          source.downloadCount = 0;
          console.error(`[download-sources] falha ao adicionar ${sourceUrl}: ${error.message}`);
        }
      }

      ctx.persist();
      return ok(added, 201);
    },
  },
  {
    method: "DELETE",
    pattern: "/profile/download-sources",
    auth: true,
    handler: ({ db, url, ctx }) => {
      const removeAll = url.searchParams.get("all") === "true";
      const id =
        url.searchParams.get("downloadSourceId") || url.searchParams.get("id");

      if (removeAll) {
        db.downloadSources = [];
        db.downloadSourceRepacks = [];
      } else if (id) {
        db.downloadSources = (db.downloadSources || []).filter(
          (source) => source.id !== id
        );
        ensureDownloadSourceRepacks(db);
        db.downloadSourceRepacks = db.downloadSourceRepacks.filter(
          (repack) => repack.downloadSourceId !== id
        );
      }

      ctx.persist();
      return ok({});
    },
  },
  {
    method: "GET",
    pattern: "/profile/friends",
    auth: true,
    handler: ({ db }) =>
      ok({ totalFriends: db.friends.length, onlineFriends: 0, friends: db.friends }),
  },
  {
    method: "GET",
    pattern: "/profile/friend-requests",
    auth: true,
    handler: ({ db }) => ok(db.friendRequests),
  },
  {
    method: "POST",
    pattern: "/profile/friend-requests",
    auth: true,
    handler: ({ body, db, ctx }) => {
      const request = {
        id: `request-${randomUUID()}`,
        userId: body.userId || "",
        createdAt: new Date().toISOString(),
      };
      db.friendRequests.push(request);
      ctx.persist();
      return ok(request, 201);
    },
  },
  {
    method: "GET",
    pattern: "/profile/blocks",
    auth: true,
    handler: ({ db }) => ok({ totalBlocks: db.blocks.length, blocks: db.blocks }),
  },
  {
    method: "GET",
    pattern: "/profile/notifications",
    auth: true,
    handler: ({ db, url }) => ok(notificationResponse(db, url)),
  },
  {
    method: "GET",
    pattern: "/profile/notifications/count",
    auth: true,
    handler: ({ db }) =>
      ok({
        count: db.notifications.filter(
          (item) => !(item.isRead ?? item.read ?? false)
        ).length,
      }),
  },
  {
    method: "PATCH",
    pattern: "/profile/notifications/all/read",
    auth: true,
    handler: ({ db, ctx }) => {
      db.notifications.forEach((item) => {
        item.read = true;
        item.isRead = true;
      });
      ctx.persist();
      return ok({});
    },
  },
  {
    method: "PATCH",
    pattern: "/profile/notifications/:id/read",
    auth: true,
    handler: ({ db, params, ctx }) => {
      const notification = db.notifications.find((item) => item.id === params.id);
      if (notification) {
        notification.read = true;
        notification.isRead = true;
      }
      ctx.persist();
      return ok(notification ? normalizeStoredNotification(notification) : {});
    },
  },
  {
    method: "DELETE",
    pattern: "/profile/notifications/all",
    auth: true,
    handler: ({ db, ctx }) => {
      db.notifications = [];
      ctx.persist();
      return ok({});
    },
  },
  {
    method: "DELETE",
    pattern: "/profile/notifications/:id",
    auth: true,
    handler: ({ db, params, ctx }) => {
      db.notifications = db.notifications.filter((item) => item.id !== params.id);
      ctx.persist();
      return ok({});
    },
  },
  {
    method: "GET",
    pattern: "/profile/chats/unread",
    auth: true,
    handler: () => ok({ totalUnread: 0, conversations: [] }),
  },
  {
    method: "GET",
    pattern: "/profile/integrations/steam",
    auth: true,
    handler: () => ok({ isConnected: false, steamId: null, importedGames: 0 }),
  },
  {
    method: "GET",
    pattern: "/profile/integrations/epic",
    auth: true,
    handler: () => ok({ isConnected: false, epicAccountId: null }),
  },
  {
    method: "POST",
    pattern: "/profile/integrations/epic",
    auth: true,
    handler: () => ok({ isConnected: true }),
  },
  {
    method: "DELETE",
    pattern: "/profile/integrations/epic",
    auth: true,
    handler: () => ok({}),
  },
  {
    method: "GET",
    pattern: "/profile/integrations/retroachievements",
    auth: true,
    handler: () => ok({ isConnected: false, username: null }),
  },
  {
    method: "DELETE",
    pattern: "/profile/integrations/retroachievements",
    auth: true,
    handler: () => ok({}),
  },
  {
    method: "GET",
    pattern: "/profile/achievements/combined",
    auth: true,
    handler: () => ok({ achievements: [], hiddenReason: "none", total: 0 }),
  },
  {
    method: "GET",
    pattern: "/profile/oauth/steam/start",
    auth: true,
    handler: () => ok({ authorizationUrl: `${PUBLIC_URL}/steam-oauth` }),
  },
  {
    method: "GET",
    pattern: "/profile/cloud-saves/snapshots",
    auth: true,
    handler: () => ok([]),
  },
  {
    method: "GET",
    pattern: "/profile/games/artifacts",
    auth: true,
    handler: () => ok([]),
  },
  {
    method: "POST",
    pattern: "/presigned-urls/:type",
    auth: true,
    handler: ({ params }) =>
      ok({
        presignedUrl: `${PUBLIC_URL}/upload`,
        imageUrl: `${PUBLIC_URL}/uploads/${params.type}.png`,
        type: params.type,
      }),
  },
  {
    method: "POST",
    pattern: "/screenshots/telemetry",
    auth: true,
    handler: () => ok({}),
  },
  {
    method: "GET",
    pattern: "/users/:id",
    handler: ({ db, params }) => {
      const user = db.users[0];
      if (params.id === user.id || params.id === user.username) return ok(toProfile(user, db));
      return ok(toProfile(user, db));
    },
  },
  {
    method: "GET",
    pattern: "/users/:id/stats",
    handler: ({ db, params }) =>
      ok(toUserStats(db, db.users.find((user) => user.id === params.id) || db.users[0])),
  },
  {
    method: "GET",
    pattern: "/users/:id/library",
    handler: ({ db, params, url }) => {
      const targetUser =
        db.users.find((user) => user.id === params.id) || db.users[0];
      const userLibrary = libraryOf(targetUser);
      return ok({
        totalCount: userLibrary.length,
        library: paginate(url, userLibrary),
        pinnedGames: userLibrary.filter((game) => game.isFavorite),
        userId: params.id,
      });
    },
  },
  {
    method: "GET",
    pattern: "/users/:id/reviews",
    handler: () => ok({ reviews: [], total: 0 }),
  },
  {
    method: "GET",
    pattern: "/users/:id/screenshots",
    handler: () => ok({ items: [], total: 0, hiddenReason: "none", nextCursor: null }),
  },
  {
    method: "GET",
    pattern: "/users/:id/screenshots/games",
    handler: () => ok([]),
  },
  {
    method: "GET",
    pattern: "/users/:id/souvenirs",
    handler: () =>
      ok({ items: [], total: 0, hasReachedLimit: false, hiddenReason: "none" }),
  },
  {
    method: "GET",
    pattern: "/users/:id/games/achievements",
    handler: () => ok([]),
  },
];

function defaultResponse(pathname) {
  if (pathname.startsWith("/games/")) return null;
  if (pathname.startsWith("/catalogue/")) return [];
  if (pathname.startsWith("/users/")) return {};
  if (pathname.startsWith("/profile/")) return {};
  return {};
}

export async function handleRequest(req, res, ctx) {
  withCors(res);

  const url = getRequestUrl(req);
  const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") return sendEmpty(res, 204);

  try {
    if (pathname === "/health" && req.method === "GET") {
      return sendJson(res, 200, {
        status: "ok",
        service: "mkzeira-server",
        version: APP_VERSION,
        uptime: Math.round(process.uptime()),
        time: new Date().toISOString(),
        games: ctx.db.games.length,
        users: ctx.db.users.length,
        catalogSource: ctx.catalogSource,
        catalogGeneratedAt: ctx.catalogGeneratedAt,
        catalogImages: getCatalogImageStats(),
      });
    }

    if (pathname === "/updates" && req.method === "GET") {
      const entries = await fs.readdir(UPDATES_DIR, { withFileTypes: true });
      return sendJson(res, 200, {
        path: UPDATES_DIR,
        files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      });
    }

    if (pathname.startsWith("/updates/") && req.method === "GET") {
      const fileName = path.basename(
        decodeURIComponent(pathname.slice("/updates/".length))
      );
      if (!fileName) {
        return sendJson(res, 404, {
          message: "Update file not found",
          error: "NOT_FOUND",
        });
      }

      try {
        const content = await fs.readFile(path.join(UPDATES_DIR, fileName));
        res.writeHead(200, {
          "Content-Type": updatesContentType(fileName),
          "Content-Length": content.length,
          "Cache-Control": "no-cache",
        });
        return res.end(content);
      } catch {
        return sendJson(res, 404, {
          message: "Update file not found",
          error: "NOT_FOUND",
        });
      }
    }

    if (pathname === "/login-icon.png" && (req.method === "GET" || req.method === "HEAD")) {
      let icon = null;
      try {
        icon = await fs.readFile(path.join(DATA_DIR, "login-icon.png"));
      } catch {}

      const body = icon ?? Buffer.from(LOGIN_ICON_FALLBACK);
      res.writeHead(200, {
        "Content-Type": icon ? "image/png" : "image/svg+xml",
        "Content-Length": body.length,
        "Cache-Control": "public, max-age=3600",
      });
      return res.end(req.method === "HEAD" ? undefined : body);
    }

    if ((pathname === "/" || pathname === "/login") && req.method === "GET") {
      return sendHtml(res, 200, renderAuthPage(url, ctx.config));
    }

    if (pathname === "/cloud" && req.method === "GET") {
      return sendHtml(res, 200, renderCloudPage());
    }

    if (pathname === "/bundle.js" && req.method === "GET") {
      return sendJavaScript(res, "window.__MKZEIRA_EXTERNAL_RESOURCES__=true;");
    }

    if (pathname === "/favicon.ico") return sendEmpty(res, 204);

    const body = ["POST", "PUT", "PATCH"].includes(req.method)
      ? await readJson(req)
      : {};

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = match(route.pattern, pathname);
      if (!params) continue;

      const user = route.auth ? requireUser(req, ctx.db) : null;
      const result = await route.handler({ req, url, params, body, db: ctx.db, ctx, user });

      if (result === undefined) return sendJson(res, 200, {});

      const wrapped =
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        "status" in result &&
        "body" in result;

      return sendJson(res, wrapped ? result.status : 200, wrapped ? result.body : result);
    }

    return sendJson(res, 200, defaultResponse(pathname));
  } catch (error) {
    return sendJson(res, error.status || 500, {
      message: error.message || "Erro interno do servidor",
      error: error.code || "INTERNAL_ERROR",
    });
  }
}
