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
  <title>Mkzeira Launcher - Criar email</title>
  <link rel="icon" href="/login-icon.png">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d12; color: #f5f3ff; font-family: Arial, Helvetica, sans-serif; }
    main { width: min(440px, calc(100% - 32px)); padding: 32px; border: 1px solid #2c2440; border-radius: 16px; background: #16131f; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
    .logo { display: block; width: 72px; height: 72px; object-fit: cover; border-radius: 16px; border: 1px solid #2c2440; margin: 0 auto 16px; }
    h1 { margin: 0 0 6px; font-size: 28px; text-align: center; }
    p { margin: 0 0 24px; color: #a89fb8; font-size: 14px; line-height: 1.5; }
    .lead { text-align: center; }
    label { display: block; margin: 0 0 6px; font-size: 13px; color: #c4b5fd; }
    input, select { width: 100%; margin-bottom: 16px; padding: 12px 14px; border: 1px solid #3a3050; border-radius: 9px; background: #0f0d16; color: #fff; font-size: 15px; outline: none; }
    input:focus, select:focus { border-color: #a78bfa; }
    .tabs { display: flex; gap: 6px; margin-bottom: 20px; padding: 4px; border: 1px solid #3a3050; border-radius: 10px; background: #211b2e; }
    .tabs button { flex: 1; padding: 10px; border: 0; border-radius: 8px; background: transparent; color: #a89fb8; font-size: 13px; font-weight: 700; cursor: pointer; }
    .tabs button.active { background: #7c3aed; color: #fff; }
    .birth-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 10px; }
    button { width: 100%; padding: 13px; border: 0; border-radius: 9px; background: #7c3aed; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    button:hover { background: #8b5cf6; }
    button:disabled { opacity: .6; cursor: wait; }
    button.secondary { margin-top: 10px; border: 1px solid #3a3050; background: transparent; color: #f5f3ff; font-size: 13px; }
    .hint { margin: 18px 0 0; padding: 12px; border-radius: 8px; background: #211b2e; color: #c4b5fd; font-size: 12px; }
    .hint-inline { margin: -8px 0 16px; color: #a89fb8; font-size: 12px; }
    .error, .info { margin: 0 0 14px; font-size: 13px; min-height: 18px; }
    .error { color: #fca5a5; }
    .info { color: #86efac; }
    .credentials { margin-top: 16px; padding: 12px; border: 1px solid rgba(134,239,172,.35); border-radius: 9px; background: rgba(134,239,172,.06); font-size: 13px; }
    .credentials div { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .credentials span { color: #a89fb8; }
    .credentials code { color: #86efac; font-weight: 700; letter-spacing: 2px; }
    .hidden { display: none !important; }
    footer { margin-top: 20px; text-align: center; color: #6b6280; font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <img class="logo" src="/login-icon.png" alt="Mkzeira">
    <h1>Mkzeira Launcher</h1>
    <p class="lead">Crie seu email Mkzeira. O login será devolvido ao launcher pelo protocolo mkzeiralauncher.</p>
    <form id="form">
      <div class="tabs">
        <button type="button" id="tab-create" class="active">Criar email</button>
        <button type="button" id="tab-session">ID de sessão</button>
      </div>
      <div class="error" id="error"></div>
      <div data-mode="create">
        <label for="email">Email Mkzeira</label>
        <input id="email" type="email" placeholder="gustavoalberto@mkz.com" autocomplete="email" required>
        <div class="birth-row">
          <div>
            <label for="birth-year">Ano</label>
            <select id="birth-year" required></select>
          </div>
          <div>
            <label for="birth-month">Mês</label>
            <select id="birth-month" required></select>
          </div>
          <div>
            <label for="birth-day">Dia</label>
            <select id="birth-day" required></select>
          </div>
        </div>
        <label for="gender">Sexo</label>
        <select id="gender" required>
          <option value="">Selecione</option>
          <option value="homem">Homem</option>
          <option value="mulher">Mulher</option>
        </select>
      </div>
      <div data-mode="session" class="hidden">
        <label for="session-code-input">ID de sessão</label>
        <input id="session-code-input" type="text" maxlength="9" placeholder="ABC123XYZ" autocomplete="off" required>
        <p class="hint-inline">Use o ID de sessão para entrar em outro dispositivo.</p>
      </div>
      <button id="submit" type="submit">Criar email</button>
    </form>
    <div id="credentials" class="credentials hidden">
      <div><span>ID:</span> <code id="user-id"></code></div>
      <div><span>ID de sessão:</span> <code id="session-code-value"></code></div>
      <button type="button" class="secondary" id="copy-session">Copiar ID de sessão</button>
    </div>
    <p class="hint">O ID de sessão tem 9 caracteres com números e letras maiúsculas. Guarde esse código: ele entra em qualquer dispositivo com o launcher.</p>
    <footer>Mkzeira Server v${APP_VERSION}</footer>
  </main>
  <script>
    (function () {
      var state = { mode: "create", auth: null };
      var form = document.getElementById("form");
      var errorBox = document.getElementById("error");
      var button = document.getElementById("submit");
      var tabCreate = document.getElementById("tab-create");
      var tabSession = document.getElementById("tab-session");
      var credentials = document.getElementById("credentials");
      var userIdValue = document.getElementById("user-id");
      var sessionCodeValue = document.getElementById("session-code-value");
      var emailInput = document.getElementById("email");
      var birthYear = document.getElementById("birth-year");
      var birthMonth = document.getElementById("birth-month");
      var birthDay = document.getElementById("birth-day");
      var gender = document.getElementById("gender");
      var sessionCode = document.getElementById("session-code-input");
      var createInputs = [emailInput, birthYear, birthMonth, birthDay, gender];
      var createSections = document.querySelectorAll("[data-mode=create]");
      var sessionSections = document.querySelectorAll("[data-mode=session]");

      function setMessage(text, kind) {
        errorBox.className = kind === "info" ? "info" : "error";
        errorBox.textContent = text;
      }

      function clearMessage() {
        errorBox.className = "error";
        errorBox.textContent = "";
      }

      function setMode(mode) {
        state.mode = mode;
        var isSession = mode === "session";
        tabCreate.classList.toggle("active", !isSession);
        tabSession.classList.toggle("active", isSession);
        createSections.forEach(function (section) { section.classList.toggle("hidden", isSession); });
        sessionSections.forEach(function (section) { section.classList.toggle("hidden", !isSession); });
        createInputs.forEach(function (input) { input.disabled = isSession; });
        sessionCode.disabled = !isSession;
        button.textContent = isSession ? "Entrar" : "Criar email";
        clearMessage();
      }

      function updateDays() {
        var year = Number(birthYear.value);
        var month = Number(birthMonth.value);
        var days = new Date(Date.UTC(year, month, 0)).getUTCDate();
        birthDay.innerHTML = "";
        for (var day = 1; day <= days; day += 1) {
          var option = document.createElement("option");
          option.value = String(day);
          option.textContent = String(day);
          birthDay.appendChild(option);
        }
      }

      function populateBirthFields() {
        var currentYear = new Date().getFullYear();
        for (var year = currentYear; year >= 1900; year -= 1) {
          var yearOption = document.createElement("option");
          yearOption.value = String(year);
          yearOption.textContent = String(year);
          birthYear.appendChild(yearOption);
        }
        var months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        months.forEach(function (name, index) {
          var option = document.createElement("option");
          option.value = String(index + 1);
          option.textContent = name;
          birthMonth.appendChild(option);
        });
        birthYear.value = "2000";
        birthMonth.value = "1";
        updateDays();
        birthDay.value = "1";
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

      birthYear.addEventListener("change", updateDays);
      birthMonth.addEventListener("change", updateDays);
      populateBirthFields();
      setMode("create");

      tabCreate.addEventListener("click", function () { setMode("create"); });
      tabSession.addEventListener("click", function () { setMode("session"); });

      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage();
        var mode = state.mode;
        var endpoint;
        var body;

        if (mode === "create") {
          var email = emailInput.value.trim().toLowerCase();
          if (!/^[a-z0-9._%+-]+@mkz\.com$/.test(email)) {
            setMessage("Use um email no formato gustavoalberto@mkz.com.");
            return;
          }
          if (!gender.value) {
            setMessage("Escolha o sexo: homem ou mulher.");
            return;
          }
          endpoint = "/auth/create-email";
          body = {
            email: email,
            birthYear: Number(birthYear.value),
            birthMonth: Number(birthMonth.value),
            birthDay: Number(birthDay.value),
            gender: gender.value
          };
        } else {
          var code = sessionCode.value.trim().toUpperCase();
          if (!/^[0-9A-Z]{9}$/.test(code)) {
            setMessage("O ID de sessão deve ter 9 caracteres.");
            return;
          }
          endpoint = "/auth/session/login";
          body = { sessionId: code };
        }

        button.disabled = true;
        button.textContent = "Aguarde...";

        try {
          var response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          var data = await response.json().catch(function () { return {}; });
          if (!response.ok) {
            throw new Error(data.message || "Falha (" + response.status + ")");
          }

          state.auth = data;
          if (mode === "create") {
            userIdValue.textContent = data.userId || (data.user && data.user.id) || "";
            sessionCodeValue.textContent = data.sessionId || "";
            credentials.classList.remove("hidden");
            setMessage("Email criado. Guarde o ID de sessão para entrar em outro dispositivo.", "info");
          } else {
            setMessage("Login realizado. Abrindo o launcher...", "info");
          }

          setTimeout(function () {
            window.location.href = buildDeepLink(state.auth);
          }, mode === "create" ? 1200 : 350);
        } catch (error) {
          setMessage(error.message || "Não foi possível entrar.");
          button.disabled = false;
          button.textContent = mode === "session" ? "Entrar" : "Criar email";
        }
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
      if (params.get("mode") === "session" || window.location.pathname === "/login") {
        setMode("session");
      }
    })();
  </script>
</body>
</html>`;
}
