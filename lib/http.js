export function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, If-None-Match, Mkzeira-If-Modified-Since"
  );
  res.setHeader("Access-Control-Expose-Headers", "ETag, Last-Modified");
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

export function sendHtml(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function sendJavaScript(res, body) {
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function sendEmpty(res, status = 204) {
  res.writeHead(status);
  res.end();
}

export function getRequestUrl(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
}

export async function readJson(req) {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      const error = new Error("Corpo da requisição muito grande");
      error.status = 413;
      throw error;
    }
  }

  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("JSON inválido");
    error.status = 400;
    throw error;
  }
}

export function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
