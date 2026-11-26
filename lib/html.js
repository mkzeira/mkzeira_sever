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

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Entrar | Mkzeira Launcher</title>
  <link rel="icon" href="/login-icon.png">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% -20%, #2b1b4d, #0d0d12 55%); color: #f5f3ff; font-family: Arial, Helvetica, sans-serif; }
    main { width: min(460px, calc(100% - 32px)); padding: 34px; border: 1px solid #332a49; border-radius: 22px; background: rgba(22,19,31,.96); box-shadow: 0 30px 80px rgba(0,0,0,.5); }
    .logo { display: block; width: 68px; height: 68px; object-fit: cover; border-radius: 18px; border: 1px solid #3a3050; margin: 0 auto 18px; }
    h1 { margin: 0 0 8px; font-size: 27px; text-align: center; letter-spacing: -.4px; }
    .subtitle { margin: 0 0 24px; color: #a89fb8; font-size: 14px; line-height: 1.5; text-align: center; }
    .eyebrow { margin: 0 0 18px; color: #a78bfa; font-size: 11px; font-weight: 700; letter-spacing: 1.8px; text-align: center; text-transform: uppercase; }
    .progress { display: flex; justify-content: center; gap: 6px; margin: 0 0 22px; }
    .progress span { width: 22px; height: 4px; border-radius: 99px; background: #332a49; }
    .progress span.active { background: #8b5cf6; }
    label { display: block; margin: 0 0 7px; font-size: 13px; color: #c4b5fd; }
    input { width: 100%; margin-bottom: 14px; padding: 13px 14px; border: 1px solid #3a3050; border-radius: 10px; background: #0f0d16; color: #fff; font-size: 15px; outline: none; }
    input:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.16); }
    button { width: 100%; padding: 13px; border: 0; border-radius: 10px; background: #7c3aed; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    button:hover { background: #8b5cf6; }
    button:disabled { opacity: .6; cursor: wait; }
    button.secondary { margin-top: 10px; border: 1px solid #3a3050; background: transparent; color: #f5f3ff; font-size: 14px; }
    button.secondary:hover { background: #211b2e; }
    button.link { margin-top: 12px; padding: 4px; background: transparent; color: #c4b5fd; font-size: 13px; font-weight: 600; }
    button.link:hover { background: transparent; color: #ddd6fe; }
    button.back { margin-bottom: 14px; padding: 0; background: transparent; color: #a89fb8; font-size: 13px; text-align: left; }
    button.back:hover { background: transparent; color: #ddd6fe; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 18px 0 4px; color: #6b6280; font-size: 12px; }
    .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #332a49; }
    .email-pill { margin: -8px 0 20px; padding: 10px 12px; border: 1px solid #3a3050; border-radius: 9px; background: #211b2e; color: #ddd6fe; font-size: 13px; text-align: center; }
    .error, .info { margin: 0 0 14px; font-size: 13px; min-height: 18px; text-align: center; }
    .error { color: #fca5a5; }
    .info { color: #86efac; }
    .credentials { margin-top: 18px; padding: 14px; border: 1px solid rgba(134,239,172,.35); border-radius: 10px; background: rgba(134,239,172,.06); font-size: 13px; }
    .credentials div { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .credentials span { color: #a89fb8; }
    .credentials code { color: #86efac; font-weight: 700; letter-spacing: 2px; }
    .hint { margin: 20px 0 0; color: #6b6280; font-size: 11px; line-height: 1.5; text-align: center; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <main>
    <img class="logo" src="/login-icon.png" alt="Mkzeira">
    <p class="eyebrow">Mkzeira Launcher</p>
    <div class="progress" id="progress"><span class="active"></span><span></span><span></span></div>
    <div id="message" class="error"></div>

    <section data-step="email">
      <h1>Entrar</h1>
      <p class="subtitle">Digite seu email Mkzeira para continuar.</p>
      <form data-action="email">
        <label for="email">Email @mkz.com</label>
        <input id="email" type="email" placeholder="gustavoalberto@mkz.com" autocomplete="email" required>
        <button type="submit">Continuar</button>
      </form>
      <div class="divider">ou</div>
      <button type="button" class="secondary" data-go="create" data-require-email="true">Criar conta</button>
      <button type="button" class="link" data-go="session">Entrar com ID de sessão</button>
    </section>

    <section data-step="password" class="hidden">
      <button type="button" class="back" data-go="email">← Voltar</button>
      <h1>Sua senha</h1>
      <p class="email-pill" id="password-email"></p>
      <form data-action="password">
        <label for="password">Senha</label>
        <input id="password" type="password" autocomplete="current-password" required>
        <button type="submit">Entrar</button>
      </form>
      <button type="button" class="link" data-go="session">Usar ID de sessão</button>
    </section>

    <section data-step="create" class="hidden">
      <button type="button" class="back" data-go="email">← Voltar</button>
      <h1>Criar conta</h1>
      <p class="subtitle">Como você se chama?</p>
      <p class="email-pill" id="create-email"></p>
      <form data-action="create-name">
        <label for="first-name">Nome</label>
        <input id="first-name" type="text" placeholder="Gustavo" autocomplete="given-name" required>
        <label for="last-name">Sobrenome</label>
        <input id="last-name" type="text" placeholder="Alberto" autocomplete="family-name" required>
        <button type="submit">Continuar</button>
      </form>
    </section>

    <section data-step="create-password" class="hidden">
      <button type="button" class="back" data-go="create">← Voltar</button>
      <h1>Crie uma senha</h1>
      <p class="subtitle">Use pelo menos 6 caracteres para proteger sua conta.</p>
      <form data-action="create-account">
        <label for="new-password">Senha</label>
        <input id="new-password" type="password" autocomplete="new-password" required>
        <label for="confirm-password">Confirmar senha</label>
        <input id="confirm-password" type="password" autocomplete="new-password" required>
        <button type="submit">Criar conta</button>
      </form>
    </section>

    <section data-step="session" class="hidden">
      <button type="button" class="back" data-go="email">← Voltar</button>
      <h1>ID de sessão</h1>
      <p class="subtitle">Use o código de 9 caracteres para entrar em outro dispositivo.</p>
      <form data-action="session">
        <label for="session-code">ID de sessão</label>
        <input id="session-code" type="text" maxlength="9" placeholder="ABC123XYZ" autocomplete="off" required>
        <button type="submit">Entrar</button>
      </form>
    </section>

    <div id="credentials" class="credentials hidden">
      <div><span>ID:</span> <code id="user-id"></code></div>
      <div><span>ID de sessão:</span> <code id="session-code-value"></code></div>
      <button type="button" class="secondary" id="copy-session">Copiar ID de sessão</button>
    </div>
    <p class="hint">Seu ID de sessão tem 9 caracteres com números e letras maiúsculas. Guarde-o para entrar em qualquer dispositivo.</p>
  </main>
  <script>
    (function () {
      var state = { step: "email", email: "", firstName: "", lastName: "", auth: null };
      var message = document.getElementById("message");
      var steps = document.querySelectorAll("[data-step]");
      var progress = document.querySelectorAll("#progress span");
      var emailInput = document.getElementById("email");
      var passwordInput = document.getElementById("password");
      var firstNameInput = document.getElementById("first-name");
      var lastNameInput = document.getElementById("last-name");
      var newPasswordInput = document.getElementById("new-password");
      var confirmPasswordInput = document.getElementById("confirm-password");
      var sessionCodeInput = document.getElementById("session-code");
      var passwordEmail = document.getElementById("password-email");
      var createEmail = document.getElementById("create-email");
      var credentials = document.getElementById("credentials");
      var userIdValue = document.getElementById("user-id");
      var sessionCodeValue = document.getElementById("session-code-value");

      function setMessage(text, kind) {
        message.className = kind === "info" ? "info" : "error";
        message.textContent = text || "";
      }

      function normalizeEmail(value) {
        return String(value || "").trim().toLowerCase();
      }

      function isValidEmail(value) {
        return /^[a-z0-9._%+-]+@mkz\.com$/.test(normalizeEmail(value));
      }

      function showStep(step) {
        state.step = step;
        steps.forEach(function (section) {
          section.classList.toggle("hidden", section.dataset.step !== step);
        });
        var activeStep = step === "email" || step === "session" ? 0 : step === "password" || step === "create" ? 1 : 2;
        progress.forEach(function (dot, index) {
          dot.classList.toggle("active", index <= activeStep);
        });
        setMessage("");
      }

      function setBusy(form, busy, label) {
        var button = form.querySelector("button[type=submit]");
        button.disabled = busy;
        button.textContent = busy ? "Aguarde..." : label;
      }

      async function requestJson(endpoint, body) {
        var response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.message || "Falha (" + response.status + ")");
        return data;
      }

      function toBase64Utf8(value) {
        return btoa(unescape(encodeURIComponent(value)));
      }

      function buildDeepLink(auth) {
        var payload = toBase64Utf8(JSON.stringify({
          accessToken: auth.accessToken,
          refreshToken: auth.refreshToken,
          expiresIn: auth.expiresIn,
          sessionId: auth.sessionId || "",
          userId: auth.userId || (auth.user && auth.user.id) || "",
          workwondersJwt: auth.workwondersJwt || ""
        }));
        return "mkzeiralauncher://auth?payload=" + encodeURIComponent(payload);
      }

      function finish(auth, delay) {
        state.auth = auth;
        setTimeout(function () {
          window.location.href = buildDeepLink(auth);
        }, delay);
      }

      function showCredentials(auth) {
        userIdValue.textContent = auth.userId || (auth.user && auth.user.id) || "";
        sessionCodeValue.textContent = auth.sessionId || "";
        credentials.classList.remove("hidden");
      }

      document.querySelectorAll("[data-go]").forEach(function (button) {
        button.addEventListener("click", function () {
          if (button.dataset.requireEmail === "true") {
            if (!isValidEmail(emailInput.value)) {
              setMessage("Digite um email @mkz.com antes de criar a conta.");
              emailInput.focus();
              return;
            }
            state.email = normalizeEmail(emailInput.value);
            createEmail.textContent = state.email;
          }
          showStep(button.dataset.go);
        });
      });

      document.querySelectorAll("form[data-action]").forEach(function (form) {
        form.addEventListener("submit", async function (event) {
          event.preventDefault();
          setMessage("");
          var action = form.dataset.action;
          var submitLabel = form.querySelector("button[type=submit]").textContent;

          try {
            if (action === "email") {
              if (!isValidEmail(emailInput.value)) {
                setMessage("Use um email no formato gustavoalberto@mkz.com.");
                return;
              }
              state.email = normalizeEmail(emailInput.value);
              passwordEmail.textContent = state.email;
              createEmail.textContent = state.email;
              setBusy(form, true);
              var check = await requestJson("/auth/check-email", { email: state.email });
              setBusy(form, false, submitLabel);
              showStep(check.exists ? "password" : "create");
              return;
            }

            if (action === "password") {
              if (!passwordInput.value) {
                setMessage("Digite sua senha.");
                return;
              }
              setBusy(form, true);
              var auth = await requestJson("/api/auth/login", {
                email: state.email,
                password: passwordInput.value
              });
              setMessage("Login realizado. Abrindo o launcher...", "info");
              finish(auth, 350);
              return;
            }

            if (action === "create-name") {
              state.firstName = firstNameInput.value.trim();
              state.lastName = lastNameInput.value.trim();
              if (!state.firstName || !state.lastName) {
                setMessage("Digite seu nome e sobrenome.");
                return;
              }
              showStep("create-password");
              return;
            }

            if (action === "create-account") {
              var password = newPasswordInput.value;
              if (password.length < 6) {
                setMessage("A senha deve ter pelo menos 6 caracteres.");
                return;
              }
              if (password !== confirmPasswordInput.value) {
                setMessage("As senhas não coincidem.");
                return;
              }
              setBusy(form, true);
              var created = await requestJson("/auth/create-email", {
                email: state.email,
                firstName: state.firstName,
                lastName: state.lastName,
                password: password
              });
              setBusy(form, false, submitLabel);
              showCredentials(created);
              setMessage("Conta criada. Guarde o ID de sessão.", "info");
              finish(created, 1200);
              return;
            }

            if (action === "session") {
              var code = String(sessionCodeInput.value || "").trim().toUpperCase();
              if (!/^[0-9A-Z]{9}$/.test(code)) {
                setMessage("O ID de sessão deve ter 9 caracteres.");
                return;
              }
              setBusy(form, true);
              var sessionAuth = await requestJson("/auth/session/login", { sessionId: code });
              setMessage("Login realizado. Abrindo o launcher...", "info");
              finish(sessionAuth, 350);
            }
          } catch (error) {
            setBusy(form, false, submitLabel);
            setMessage(error.message || "Não foi possível continuar.");
          }
        });
      });

      document.getElementById("copy-session").addEventListener("click", async function () {
        var code = sessionCodeValue.textContent.trim();
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          setMessage("ID de sessão copiado.", "info");
        } catch (error) {
          setMessage("Não foi possível copiar.", "error");
        }
      });

      var params = new URLSearchParams(window.location.search);
      if (params.get("lng")) document.documentElement.lang = params.get("lng");
      showStep(params.get("mode") === "session" ? "session" : "email");
      if (state.step === "email") emailInput.focus();
    })();
  </script>
</body>
</html>`;
}
