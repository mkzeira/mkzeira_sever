import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const { loadDb, saveDb } = await import("../lib/db.js");

const args = process.argv.slice(2);

function has(flag) {
  return args.includes(flag);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
}

function label(user) {
  return [user.displayName, user.username].filter(Boolean).join(" @") || user.id;
}

function referencesUser(value, userId) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => referencesUser(entry, userId));
  const directKeys = new Set([
    "id",
    "userId",
    "friendId",
    "ownerId",
    "from",
    "to",
    "senderId",
    "recipientId",
  ]);
  const arrayKeys = new Set(["participants", "members", "userIds"]);
  return Object.entries(value).some(([key, entry]) => {
    if (directKeys.has(key) && entry === userId) return true;
    if (arrayKeys.has(key) && Array.isArray(entry) && entry.includes(userId)) return true;
    return false;
  });
}

function cleanCollection(collection, userId) {
  if (Array.isArray(collection)) {
    return collection.filter((entry) => !referencesUser(entry, userId));
  }
  if (collection && typeof collection === "object") {
    return Object.fromEntries(
      Object.entries(collection).filter(([, entry]) => !referencesUser(entry, userId))
    );
  }
  return collection;
}

function printHelp() {
  console.log("Uso:");
  console.log("  node scripts/accounts.mjs                    resumo de contas e sessões válidas");
  console.log("  node scripts/accounts.mjs --list             usuários com sessão válida");
  console.log("  node scripts/accounts.mjs --list-accounts    todas as contas cadastradas");
  console.log("  node scripts/accounts.mjs --find-email <email>  busca uma conta pelo email");
  console.log("  node scripts/accounts.mjs --delete <id>      simula apagar uma conta");
  console.log("  node scripts/accounts.mjs --delete <id> --confirm  apaga de verdade");
  console.log("");
  console.log("Aviso: sessão válida não é presença online em tempo real.");
  console.log("Antes de apagar, pare o servidor para ele não sobrescrever a alteração.");
}

if (has("--help") || has("-h")) {
  printHelp();
  process.exit(0);
}

const db = await loadDb();
const now = Date.now();
const sessions = Object.entries(db.sessions || {});
const activeSessions = sessions.filter(([, session]) => Number(session?.expiresAt) > now);
const activeByUser = new Map();

for (const [, session] of activeSessions) {
  const userId = session?.userId;
  if (!userId) continue;
  const expiresAt = Number(session.expiresAt);
  const entry = activeByUser.get(userId) || { sessions: 0, expiresAt: 0 };
  entry.sessions += 1;
  if (expiresAt > entry.expiresAt) entry.expiresAt = expiresAt;
  activeByUser.set(userId, entry);
}

const source = process.env.DATABASE_URL ? "Postgres/Supabase" : "data/db.json";

console.log("=== MKzeira Launcher: contas e sessões ===");
console.log(`fonte=${source}`);
console.log(`contas=${db.users.length}`);
console.log(`sessoes_total=${sessions.length}`);
console.log(`sessoes_validas=${activeSessions.length}`);
console.log(`sessoes_expiradas=${sessions.length - activeSessions.length}`);
console.log(`usuarios_com_sessao_valida=${activeByUser.size}`);
console.log("criterio=sessao refresh nao expirada, ate 30 dias apos o login");
console.log("aviso=isso nao mede quem esta online agora, so quem tem sessao valida no banco");

if (has("--list-accounts")) {
  console.log("");
  console.log("contas:");
  for (const user of db.users) {
    console.log(`- ${label(user)} | id=${user.id} | criado=${user.createdAt || "n/d"}`);
  }
}

if (has("--list")) {
  console.log("");
  console.log("usuarios com sessao valida:");
  for (const [userId, entry] of activeByUser) {
    const user = db.users.find((candidate) => candidate.id === userId);
    const expiresAt = new Date(entry.expiresAt).toISOString();
    console.log(`- ${user ? label(user) : userId} | id=${userId} | sessoes=${entry.sessions} | expira=${expiresAt}`);
  }
}

const findEmail = valueAfter("--find-email");
if (findEmail) {
  const needle = findEmail.trim().toLowerCase();
  const found = db.users.find(
    (user) => String(user.email || "").trim().toLowerCase() === needle
  );
  console.log("");
  if (!found) {
    console.log(`conta_nao_encontrada=${needle}`);
  } else {
    const userSessions = Object.values(db.sessions || {}).filter(
      (session) => session?.userId === found.id
    ).length;
    console.log(`conta_encontrada=${needle}`);
    console.log(`- ${label(found)} | id=${found.id} | criado=${found.createdAt || "n/d"} | sessoes=${userSessions}`);
  }
}

const deleteId = valueAfter("--delete");
if (deleteId) {
  const index = db.users.findIndex((user) => user.id === deleteId);
  if (index === -1) {
    console.error(`conta nao encontrada: ${deleteId}`);
    process.exitCode = 1;
  } else {
    const user = db.users[index];
    const ownedSessions = Object.entries(db.sessions || {}).filter(
      ([, session]) => session?.userId === deleteId
    );
    console.log("");
    console.log(`conta_selecionada=${label(user)} | id=${deleteId} | sessoes=${ownedSessions.length}`);
    if (!has("--confirm")) {
      console.log("modo=simulacao");
      console.log("use --confirm para apagar de verdade");
      console.log("pare o servidor antes de confirmar");
    } else {
      db.users.splice(index, 1);
      for (const [token] of ownedSessions) delete db.sessions[token];
      for (const key of [
        "friends",
        "friendRequests",
        "blocks",
        "notifications",
        "events",
        "library",
        "collections",
        "downloadSources",
        "downloadSourceRepacks",
      ]) {
        if (Array.isArray(db[key])) db[key] = cleanCollection(db[key], deleteId);
      }
      if (db.chats && typeof db.chats === "object") {
        db.chats = cleanCollection(db.chats, deleteId);
      }
      await saveDb(db);
      console.log(`conta_apagada=${deleteId}`);
      console.log(`sessoes_removidas=${ownedSessions.length}`);
    }
  }
}
