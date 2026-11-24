import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

let cachedSecret;

export function getSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }

  if (cachedSecret) return cachedSecret;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const secretPath = path.join(DATA_DIR, "secret.key");

  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(48).toString("hex"), {
      mode: 0o600,
    });
  }

  cachedSecret = fs.readFileSync(secretPath, "utf8").trim();
  return cachedSecret;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return { passwordSalt: salt, passwordHash: hash };
}

export function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;

  try {
    const hash = crypto.scryptSync(String(password), user.passwordSalt, 32);
    const expected = Buffer.from(user.passwordHash, "hex");
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

export function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encode(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + ttlSeconds,
      jti: crypto.randomUUID(),
    })
  );
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;

  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;

  const body = parts.length === 3 ? parts[1] : parts[0];
  const signature = parts.at(-1);
  const signedInput = parts.length === 3 ? `${parts[0]}.${body}` : body;
  if (!body || !signature) return null;

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(signedInput)
    .digest("base64url");

  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function issueTokens(user) {
  const claims = { sub: user.id, userId: user.id };
  return {
    accessToken: signToken({ ...claims, type: "access" }, 60 * 60),
    refreshToken: signToken({ ...claims, type: "refresh" }, 60 * 60 * 24 * 30),
    expiresIn: 60 * 60,
    workwondersJwt: `mkzeira-local-${user.id}`,
  };
}
