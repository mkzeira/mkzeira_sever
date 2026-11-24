import { APP_VERSION } from "./config.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderCloudPage() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mkzeira Cloud</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d12; color: #f5f3ff; font-family: Arial, Helvetica, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); padding: 28px; border: 1px solid #2c2440; border-radius: 16px; background: #16131f; text-align: center; }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0; color: #a89fb8; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Mkzeira Cloud</h1>
    <p>O servidor local não fornece nuvem remota. Configure um provedor externo em <strong>MAIN_VITE_CHECKOUT_URL</strong> para usar esta função.</p>
  </main>
</body>
</html>`;
}

export function renderAuthPage(url, config) {
  const language = url.searchParams.get("lng") || "pt-BR";
  const username = escapeHtml(config.DEMO_USERNAME);
  const password = escapeHtml(config.DEMO_PASSWORD);

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mkzeira Launcher</title>
  <link rel="icon" href="/login-icon.png">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d12; color: #f5f3ff; font-family: Arial, Helvetica, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); padding: 32px; border: 1px solid #2c2440; border-radius: 16px; background: #16131f; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
    .logo { display: block; width: 72px; height: 72px; object-fit: cover; border-radius: 16px; border: 1px solid #2c2440; margin: 0 auto 16px; }
    h1 { margin: 0 0 6px; font-size: 28px; text-align: center; }
    p { margin: 0 0 24px; color: #a89fb8; font-size: 14px; line-height: 1.5; }
    .lead { text-align: center; }
    label { display: block; margin: 0 0 6px; font-size: 13px; color: #c4b5fd; }
    input { width: 100%; margin-bottom: 16px; padding: 12px 14px; border: 1px solid #3a3050; border-radius: 9px; background: #0f0d16; color: #fff; font-size: 15px; outline: none; }
    input:focus { border-color: #a78bfa; }
    button { width: 100%; padding: 13px; border: 0; border-radius: 9px; background: #7c3aed; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    button:hover { background: #8b5cf6; }
    button:disabled { opacity: .6; cursor: wait; }
    .hint { margin: 18px 0 0; padding: 12px; border-radius: 8px; background: #211b2e; color: #c4b5fd; font-size: 12px; }
    .error { margin: 0 0 14px; color: #fca5a5; font-size: 13px; min-height: 18px; }
    footer { margin-top: 20px; text-align: center; color: #6b6280; font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <img class="logo" src="/login-icon.png" alt="Mkzeira">
    <h1>Mkzeira Launcher</h1>
    <p class="lead">Entre com a conta do seu servidor. O login será devolvido ao launcher pelo protocolo mkzeira/mkzeiralauncher.</p>
    <form id="login-form">
      <div class="error" id="error"></div>
      <label for="username">Usuário ou e-mail</label>
      <input id="username" name="username" autocomplete="username" value="${username}" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" value="${password}" required>
      <button id="submit" type="submit">Entrar</button>
    </form>
    <p class="hint">Conta inicial: <strong>${username}</strong> / <strong>${password}</strong>. Troque pelos dados do seu servidor.</p>
    <footer>Mkzeira Server v${APP_VERSION}</footer>
  </main>
  <script>
    (function () {
      var form = document.getElementById("login-form");
      var errorBox = document.getElementById("error");
      var button = document.getElementById("submit");

      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        errorBox.textContent = "";
        button.disabled = true;
        button.textContent = "Entrando...";

        try {
          var response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: document.getElementById("username").value,
              password: document.getElementById("password").value
            })
          });
          var data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || "Falha no login");
          }

          var payload = {
            accessToken: data.accessToken,
            expiresIn: data.expiresIn,
            refreshToken: data.refreshToken,
            workwondersJwt: data.workwondersJwt
          };
          var encoded = btoa(JSON.stringify(payload));
          window.location.href = "mkzeiralauncher://auth?payload=" + encodeURIComponent(encoded);
        } catch (error) {
          errorBox.textContent = error.message || "Não foi possível entrar";
          button.disabled = false;
          button.textContent = "Entrar";
        }
      });
    })();
  </script>
</body>
</html>`;
}
