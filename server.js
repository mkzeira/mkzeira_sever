import { createHash } from "node:crypto";
import http from "node:http";
import * as config from "./lib/config.js";
import {
  CATALOG_REFRESH_MS,
  DATA_DIR,
  HOST,
  PORT,
  PUBLIC_URL,
} from "./lib/config.js";
import { loadCatalogGames, loadDb, saveDb } from "./lib/db.js";
import { handleRequest, refreshAllDownloadSources } from "./lib/router.js";

const db = await loadDb();
const apiDb = { ...db, games: Array.isArray(db.games) ? db.games : [] };

function buildCatalogMeta(games) {
  const genres = new Set();
  const tags = {};
  const developers = new Set();
  const publishers = new Set();
  for (const game of games) {
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

function persist() {
  db.downloadSources = apiDb.downloadSources;
  db.downloadSourceRepacks = apiDb.downloadSourceRepacks;
  db.sessions = apiDb.sessions;
  saveDb(db).catch((error) => {
    console.error(`[db] falha ao persistir: ${error.message}`);
  });
}

const context = {
  db: apiDb,
  config,
  persist,
  catalogSource: "local",
  catalogGeneratedAt: new Date().toISOString(),
  catalogMeta: buildCatalogMeta(apiDb.games),
};

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function writeWebSocketFrame(socket, opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, payload]));
}

function readWebSocketFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    const masked = Boolean(buffer[offset + 1] & 0x80);
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      const extended = buffer.readBigUInt64BE(cursor);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) break;
      length = Number(extended);
      cursor += 8;
    }

    if (masked) {
      if (cursor + 4 > buffer.length) break;
      cursor += 4;
    }

    if (cursor + length > buffer.length) break;

    frames.push({
      opcode,
      payload: buffer.subarray(cursor, cursor + length),
    });
    offset = cursor + length;
  }

  return { frames, rest: buffer.subarray(offset) };
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res, context);
});

server.on("clientError", (error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  console.error("clientError:", error.message);
});

server.on("upgrade", (req, socket) => {
  let pathname = "";
  try {
    pathname = new URL(req.url || "/", PUBLIC_URL).pathname;
  } catch {
    pathname = "";
  }

  const key = req.headers["sec-websocket-key"];
  if (pathname !== "/realtime" || typeof key !== "string") {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}${WEBSOCKET_GUID}`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );
  socket.setNoDelay(true);

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = readWebSocketFrames(buffer);
    buffer = rest;

    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        writeWebSocketFrame(socket, 0x8, frame.payload);
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        writeWebSocketFrame(socket, 0xa, frame.payload);
      }
    }
  });
  socket.on("error", () => socket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`Mkzeira Server v${config.APP_VERSION}`);
  console.log(`API:     ${PUBLIC_URL}`);
  console.log(`Login:   ${PUBLIC_URL}/`);
  console.log(`Health:  ${PUBLIC_URL}/health`);
  console.log(`Dados:   ${DATA_DIR}`);
  console.log(`Conta:   ${config.DEMO_USERNAME} / ${config.DEMO_PASSWORD}`);
  console.log(`Catálogo: ${context.catalogSource} (${apiDb.games.length} jogos)`);
  void bootstrap();
});

async function bootstrap() {
  try {
    const catalog = await loadCatalogGames(apiDb.games);
    apiDb.games = catalog.games;
    context.catalogSource = catalog.source;
    context.catalogGeneratedAt = catalog.generatedAt;
    context.catalogMeta = buildCatalogMeta(apiDb.games);
    console.log(`[catalog] ${apiDb.games.length} jogos atualizados`);

    await refreshAllDownloadSources(apiDb, context);
    console.log(`[download-sources] ${apiDb.downloadSources.length} fontes sincronizadas`);

    if (CATALOG_REFRESH_MS > 0) {
      const timer = setInterval(() => {
        void (async () => {
          const next = await loadCatalogGames(apiDb.games);
          if (next.source !== "github") return;
          apiDb.games = next.games;
          context.catalogSource = next.source;
          context.catalogGeneratedAt = next.generatedAt;
          context.catalogMeta = buildCatalogMeta(apiDb.games);
          console.log(`[catalog] ${apiDb.games.length} jogos atualizados`);
        })();
      }, CATALOG_REFRESH_MS);
      timer.unref();
    }
  } catch (error) {
    console.error(`[bootstrap] falha: ${error.message}`);
  }
}

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (error) => {
  console.error("uncaughtException:", error);
});
