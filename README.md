# Mkzeira Server

API funcional para o Mkzeira Launcher. Roda com Node puro, sem dependências externas, e já serve a página de login que devolve o token ao launcher pelo deep link.

## Requisitos

- Node.js 20 ou superior
- porta `4000` livre por padrão

## Rodar local

```powershell
cd C:\Users\nickc\OneDrive\Desktop\mkzeira-server
npm start
```

Acessos:

- Login: `http://localhost:4000/`
- Health check: `http://localhost:4000/health`
- Conta inicial: `mkzeira` / `mkzeira`

O banco é criado automaticamente em `data/db.json` com jogos, biblioteca e collections de exemplo. O segredo dos tokens fica em `data/secret.key`.

## Apontar o launcher para este servidor

Edite o `.env` do projeto do launcher:

```env
MAIN_VITE_API_URL=http://localhost:4000
MAIN_VITE_AUTH_URL=http://localhost:4000
MAIN_VITE_CHECKOUT_URL=http://localhost:4000
MAIN_VITE_EXTERNAL_RESOURCES_URL=http://localhost:4000
```

Depois recompile o launcher:

```powershell
cd C:\Users\nickc\OneDrive\Desktop\mkzeira-launcher
$env:NODE_OPTIONS='--max-old-space-size=3072'
yarn electron-vite build
```

Para produção, troque `localhost:4000` pela URL publicada do servidor.

## GitHub + deploy

1. Crie um repositório no GitHub e envie esta pasta.
2. Configure as variáveis de ambiente no seu provedor:

```env
PORT=4000
HOST=0.0.0.0
PUBLIC_URL=https://seu-servidor.exemplo
JWT_SECRET=um-segredo-longo-e-aleatorio
DEMO_USERNAME=mkzeira
DEMO_PASSWORD=troque-esta-senha
DATA_DIR=/app/data
```

3. Use `npm start` como comando de inicialização. Não há build.
4. Se o provedor usar Docker, o `Dockerfile` já expõe a porta `4000`.
5. Se houver volume persistente, monte em `/app/data` para manter usuários, biblioteca e tokens entre deploys.

O protocolo de retorno do login continua `mkzeiralauncher://auth?payload=...` porque é o registrado no app; isso é esperado mesmo com a identidade Mkzeira.

## Endpoints principais

| Método | Rota | Uso |
|---|---|---|
| GET | `/health` | status do servidor |
| GET | `/` | página de login do launcher |
| POST | `/api/auth/login` | emite access/refresh token |
| POST | `/auth/refresh` | renova o access token |
| GET | `/profile/me` | dados do usuário logado |
| GET | `/features` | feature flags |
| GET | `/catalogue/hot` | jogos em destaque |
| GET | `/catalogue/featured` | hero da home |
| POST | `/catalogue/search` | busca |
| GET | `/games/:shop/:objectId` | detalhes do jogo |
| GET | `/games/:shop/:objectId/download-sources` | fontes de download |
| GET | `/profile/games` | biblioteca do usuário |
| POST | `/profile/games` | adiciona jogo à biblioteca |
| GET | `/profile/notifications` | notificações |

Rotas adicionais de perfil, amigos, chat, cloud saves e leaderboards respondem com dados válidos para evitar erros no launcher.

## Segurança

Antes de publicar, troque `JWT_SECRET` e `DEMO_PASSWORD`. As senhas são armazenadas com scrypt e os tokens são assinados com HMAC-SHA256.

## Estrutura

```text
mkzeira-server/
  server.js
  lib/config.js
  lib/auth.js
  lib/db.js
  lib/http.js
  lib/html.js
  lib/router.js
  data/
  .env.example
  Dockerfile
  README.md
```
