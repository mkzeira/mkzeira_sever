import fs from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "./auth.js";
import {
  CATALOG_BASE_URL,
  CATALOG_GAMES_FILE,
  CATALOG_INFO_FILE,
  CATALOG_LOCAL_FILE,
  DATA_DIR,
  DEMO_PASSWORD,
  DEMO_USERNAME,
} from "./config.js";

const DB_FILE = path.join(DATA_DIR, "db.json");
const CATALOG_ASSETS_FILE = path.join(DATA_DIR, "catalog-assets.json");
const generatedAssetGames = new WeakSet();
const placeholderHeroGames = new WeakSet();
const enrichedAssetGames = new WeakSet();
const steamAssetPromises = new Map();
let catalogAssetOverrides = new Map();
let catalogImageStats = { total: 0, withImage: 0, placeholder: 0 };

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgDataUri(label, width, height) {
  const short = escapeXml(String(label).slice(0, 28));
  const safeLabel = escapeXml(label);
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#4c1d95"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.78}" cy="${height * 0.22}" r="${Math.min(width, height) * 0.18}" fill="#a78bfa" opacity="0.35"/><text x="50%" y="48%" text-anchor="middle" fill="#f5f3ff" font-family="Arial,sans-serif" font-size="${Math.max(18, Math.round(Math.min(width, height) / 9))}" font-weight="700">${short}</text><text x="50%" y="58%" text-anchor="middle" fill="#c4b5fd" font-family="Arial,sans-serif" font-size="${Math.max(12, Math.round(Math.min(width, height) / 22))}">MKZEIRA</text><title>${safeLabel}</title></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(xml, "utf8").toString("base64")}`;
}

function assetSet(appId, overrides = {}) {
  const base = `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}`;
  return {
    iconUrl: `${base}/header.jpg`,
    libraryHeroImageUrl: `${base}/library_hero.jpg`,
    libraryImageUrl: `${base}/header.jpg`,
    logoImageUrl: `${base}/logo_2x.png`,
    logoPosition: "center",
    coverImageUrl: `${base}/library_600x900_2x.jpg`,
    downloadSources: [],
    ...overrides,
  };
}

function createSeed() {
  const now = new Date().toISOString();
  const gameData = [
    {
      objectId: "730",
      title: "Counter-Strike 2",
      assets: {
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/730/324b323045b09bace182f928f4104dfcd93cb7f3.ico",
        libraryImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/730/162664aa5da85f418105350c5d67ca565f6c3713/header.jpg",
      },
      genres: ["Ação", "FPS"],
      tags: { Competitivo: 98, FPS: 91, Multijogador: 88 },
      developer: "Valve",
      publisher: "Valve",
      description: "Jogo tático de tiro competitivo.",
      releaseDate: "2023-09-27",
      fileSize: "35 GB",
    },
    {
      objectId: "1091500",
      title: "Cyberpunk 2077",
      assets: {
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1091500/e8cbb253f929cb6a67dcb4f03a60dc4328ea65f2.ico",
        libraryHeroImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/1091500/cf8cec802dc47d0f24b75f9eee135e96812e2652/library_hero.jpg",
        libraryImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/1091500/e9047d8ec47ae3d94bb8b464fb0fc9e9972b4ac7/header.jpg",
        coverImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/1091500/fc7064f4a8ee2960eb51f5872d7990d771f26d2e/library_600x900_2x.jpg",
        logoImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/1091500/37680a273aeee84646db37ed0423aafee948d845/logo_2x.png",
      },
      genres: ["RPG", "Ação"],
      tags: { RPG: 96, Futuro: 84, História: 80 },
      developer: "CD Projekt Red",
      publisher: "CD Projekt",
      description: "RPG de mundo aberto em Night City.",
      releaseDate: "2020-12-10",
      fileSize: "70 GB",
    },
    {
      objectId: "367520",
      title: "Hollow Knight",
      assets: {
        libraryImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/367520/3c3489495136b26b34f8a9543c7f5645b99d388c/header.jpg",
      },
      genres: ["Metroidvania", "Plataforma"],
      tags: { Indie: 95, Difícil: 82, "2D": 88 },
      developer: "Team Cherry",
      publisher: "Team Cherry",
      description: "Explore um reino subterrâneo em ruínas.",
      releaseDate: "2017-02-24",
      fileSize: "9 GB",
    },
    {
      objectId: "1174180",
      title: "Red Dead Redemption 2",
      assets: {
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1174180/5bf6edd7efb1110b457da905e7ac696c6c619ed1.ico",
      },
      genres: ["Ação", "Aventura"],
      tags: { "Mundo Aberto": 97, Faroeste: 94, História: 86 },
      developer: "Rockstar Games",
      publisher: "Rockstar Games",
      description: "Viva a história de Arthur Morgan no Velho Oeste.",
      releaseDate: "2018-10-26",
      fileSize: "120 GB",
    },
    {
      objectId: "413150",
      title: "Stardew Valley",
      genres: ["Simulação", "Indie"],
      tags: { Fazenda: 99, Relaxante: 92, Pixel: 85 },
      developer: "ConcernedApe",
      publisher: "ConcernedApe",
      description: "Construa sua vida no campo.",
      releaseDate: "2016-02-26",
      fileSize: "1 GB",
    },
    {
      objectId: "1245620",
      title: "Elden Ring",
      assets: {
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1245620/2e048bfc2073ca30804ed5b8c454a9ca0e2f98de.ico",
      },
      genres: ["RPG", "Ação"],
      tags: { Soulslike: 98, "Mundo Aberto": 95, Difícil: 90 },
      developer: "FromSoftware",
      publisher: "Bandai Namco",
      description: "Aventura épica nas Terras Intermináveis.",
      releaseDate: "2022-02-25",
      fileSize: "60 GB",
    },
  ];

  const games = gameData.map(({ assets, ...game }) => ({
    shop: "steam",
    uri: `magnet:?xt=urn:btih:mkzeira${game.objectId}`,
    ...assetSet(game.objectId, assets),
    ...game,
  }));

  const user = {
    id: "user-mkzeira",
    username: DEMO_USERNAME,
    email: `${DEMO_USERNAME}@mkzeira.local`,
    displayName: "Mkzeira",
    bio: "Jogando no Mkzeira Launcher.",
    profileImageUrl: svgDataUri("MK", 256, 256),
    backgroundImageUrl: svgDataUri("Mkzeira", 1600, 600),
    profileVisibility: "PUBLIC",
    allowCloudGifts: true,
    allowLeaderboardNotifications: true,
    souvenirsVisibility: "PUBLIC",
    screenshotsVisibility: "PUBLIC",
    screenshotCommentsPolicy: "everyone",
    workwondersJwt: "mkzeira-local",
    subscription: null,
    karma: 0,
    quirks: { backupsPerGameLimit: 5 },
    createdAt: now,
    ...hashPassword(DEMO_PASSWORD),
  };

  const library = [];

  return {
    version: 1,
    createdAt: now,
    users: [user],
    games,
    library,
    collections: [{ id: "favoritos", name: "Favoritos", gameIds: [] }],
    downloadSources: [],
    downloadSourceRepacks: [],
    notifications: [
      {
        id: "welcome",
        type: "system",
        title: "Bem-vindo ao Mkzeira",
        body: "Seu servidor local está funcionando.",
        createdAt: now,
        read: false,
      },
    ],
    friends: [],
    friendRequests: [],
    blocks: [],
    chats: {},
    events: [],
  };
}

export async function loadDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const content = await fs.readFile(DB_FILE, "utf8");
    const stored = JSON.parse(content);
    return {
      ...stored,
      downloadSources: Array.isArray(stored.downloadSources)
        ? stored.downloadSources
        : [],
      downloadSourceRepacks: Array.isArray(stored.downloadSourceRepacks)
        ? stored.downloadSourceRepacks
        : [],
    };
  } catch {
    const seed = createSeed();
    await saveDb(seed);
    return seed;
  }
}

export async function saveDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(temporary, DB_FILE);
}

async function fetchCatalogJson(fileName) {
  const response = await fetch(`${CATALOG_BASE_URL}/${fileName}`, {
    headers: { "user-agent": "Mkzeira-Server/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${fileName}: HTTP ${response.status}`);
  return response.json();
}

function normalizeCatalogGame(entry, override = {}) {
  const objectId = String(entry.appid ?? entry.objectId ?? "");
  const title = String(entry.name ?? entry.title ?? "").replace(/\s+/g, " ").trim();
  if (!/^\d+$/.test(objectId) || !title) return null;

  const releaseYear =
    Number.parseInt(String(override.releaseDate || "").slice(0, 4), 10) || null;
  const placeholder = svgDataUri(title, 640, 360);

  const game = {
    ...assetSet(objectId, {
      iconUrl: placeholder,
      libraryHeroImageUrl: placeholder,
      libraryImageUrl: placeholder,
      logoImageUrl: placeholder,
      coverImageUrl: placeholder,
    }),
    genres: ["Outros"],
    tags: {},
    developer: "",
    publisher: "",
    description: "",
    releaseDate: "",
    fileSize: "",
    ...override,
    id: objectId,
    shop: "steam",
    uri: `/game/steam/${objectId}`,
    objectId,
    title: String(override.title || title).replace(/\s+/g, " ").trim(),
    downloadSources: [],
    releaseYear,
  };

  if (!override.iconUrl) generatedAssetGames.add(game);
  if (!override.libraryHeroImageUrl) placeholderHeroGames.add(game);
  return game;
}

async function loadCatalogAssetOverrides() {
  try {
    const raw = JSON.parse(await fs.readFile(CATALOG_ASSETS_FILE, "utf8"));
    const entries = Array.isArray(raw)
      ? raw
          .filter((item) => item && (item.objectId || item.appid))
          .map((item) => [String(item.objectId ?? item.appid), item])
      : Object.entries(raw || {});
    catalogAssetOverrides = new Map(
      entries.filter(([id, item]) => /^\d+$/.test(id) && item && typeof item === "object")
    );
  } catch (error) {
    catalogAssetOverrides = new Map();
    console.error(`[catalog] falha ao carregar assets locais: ${error.message}`);
  }
}

export async function loadCatalogGames(fallbackGames = []) {
  try {
    await loadCatalogAssetOverrides();
    const [catalog, local] = await Promise.all([
      fetchCatalogJson(CATALOG_GAMES_FILE),
      fetchCatalogJson(CATALOG_LOCAL_FILE),
    ]);

    let info = null;
    try {
      info = await fetchCatalogJson(CATALOG_INFO_FILE);
    } catch {}

    const overrides = new Map(
      (Array.isArray(local) ? local : [])
        .filter((game) => game && game.objectId)
        .map((game) => [String(game.objectId), game])
    );

    const games = (Array.isArray(catalog) ? catalog : [])
      .map((entry) => {
        const id = String(entry.appid);
        const curated = overrides.get(id) || {};
        const assets = catalogAssetOverrides.get(id) || {};
        const hasCuratedAssets =
          curated.iconUrl || curated.libraryHeroImageUrl || curated.libraryImageUrl;
        return normalizeCatalogGame(
          entry,
          hasCuratedAssets ? curated : { ...assets, ...curated }
        );
      })
      .filter(Boolean);
    games.sort(
      (a, b) =>
        Number(overrides.has(b.objectId)) - Number(overrides.has(a.objectId)) ||
        a.title.localeCompare(b.title, "pt-BR")
    );

    if (!games.length) throw new Error("catálogo remoto vazio");

    const withImage = games.filter((game) =>
      String(game.libraryImageUrl || "").startsWith("http")
    ).length;
    catalogImageStats = {
      total: games.length,
      withImage,
      placeholder: games.length - withImage,
    };

    return {
      games,
      source: "github",
      generatedAt: info?.generatedAt || null,
    };
  } catch (error) {
    console.error(`[catalog] falha ao buscar catálogo: ${error.message}`);
    return {
      games: fallbackGames.map((game) => ({
        ...game,
        uri: `/game/${game.shop}/${game.objectId}`,
      })),
      source: "local",
      generatedAt: null,
    };
  }
}

async function isReachable(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function fetchSteamAssets(objectId) {
  if (!steamAssetPromises.has(objectId)) {
    steamAssetPromises.set(
      objectId,
      (async () => {
        let data = null;
        try {
          const response = await fetch(
            `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(objectId)}&l=english&cc=us`,
            {
              headers: { "user-agent": "Mkzeira-Server/1.0" },
              signal: AbortSignal.timeout(8000),
            }
          );
          if (response.ok) {
            const payload = await response.json();
            data = payload?.[objectId]?.data || null;
          }
        } catch {}

        const legacyHeader = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${objectId}/header.jpg`;
        const header = data?.header_image
          ? data.header_image
          : (await isReachable(legacyHeader))
            ? legacyHeader
            : null;
        const background =
          data?.background && (await isReachable(data.background))
            ? data.background
            : header;
        const screenshot = data?.screenshots?.[0]?.path_full;
        return {
          header,
          background,
          screenshot:
            screenshot && (await isReachable(screenshot)) ? screenshot : header,
          description:
            data?.about_the_game || data?.detailed_description || data?.short_description || null,
          developer: data?.developers?.join(", ") || "",
          publisher: data?.publishers?.join(", ") || "",
          releaseDate: data?.release_date?.date || "",
          genres: data?.genres?.map((genre) => genre.description).filter(Boolean) || [],
        };
      })().catch(() => {
        steamAssetPromises.delete(objectId);
        return null;
      })
    );
  }
  return steamAssetPromises.get(objectId);
}

export async function enrichGamesWithAssets(games) {
  const pending = games.filter(
    (game) =>
      game &&
      game.shop === "steam" &&
      (generatedAssetGames.has(game) || placeholderHeroGames.has(game)) &&
      !enrichedAssetGames.has(game)
  );

  await Promise.all(
    pending.map(async (game) => {
      const assets = await fetchSteamAssets(game.objectId);
      if (assets) {
        if (generatedAssetGames.has(game) && assets.header) {
          game.iconUrl = assets.header;
          game.libraryImageUrl = assets.header;
          game.logoImageUrl = assets.header;
          game.coverImageUrl = assets.screenshot || assets.header;
        }
        if (assets.background || assets.header) {
          game.libraryHeroImageUrl = assets.background || assets.header;
        }
        if (assets.description) game.description = assets.description;
        if (assets.developer) game.developer = assets.developer;
        if (assets.publisher) game.publisher = assets.publisher;
        if (assets.releaseDate) game.releaseDate = assets.releaseDate;
        const hasPlaceholderGenre =
          !game.genres?.length ||
          (game.genres.length === 1 && game.genres[0] === "Outros");
        if (assets.genres?.length && hasPlaceholderGenre) game.genres = assets.genres;
      }
      if (!game.genres?.length) game.genres = ["Outros"];
      enrichedAssetGames.add(game);
    })
  );

  return games;
}

export function findGame(db, shop, objectId) {
  return (
    db.games.find(
      (game) => game.shop === shop && game.objectId === String(objectId)
    ) || null
  );
}

export function publicUser(user) {
  const { passwordSalt, passwordHash, ...safe } = user;
  return safe;
}

export function getCatalogImageStats() {
  return { ...catalogImageStats };
}

export function toShopAssets(game) {
  if (!game) return null;

  const {
    genres,
    tags,
    developer,
    publisher,
    description,
    releaseDate,
    fileSize,
    uri,
    ...assets
  } = game;

  return assets;
}
