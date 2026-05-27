# Meeting Minutes Automation

A web app that walks an organization secretary through producing board-meeting minutes:
**Setup** → **Sources** → **Per-section AI draft & review** → **Export to .docx / .pdf**.

V1 ships with the **JKP Bhakti Dham, Meeting 1** template. The architecture (template-driven section parsing, multi-tenant org/template tables) supports adding more meetings and organizations later.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19 + Vite 8 (Rolldown+Oxc), TanStack Router + Query, Tailwind CSS 4, Lucide, Chart.js, SheetJS |
| Backend | Bun 1.3 + Hono 4, `bun:sqlite`, JWT (`hono/jwt`) + `Bun.password` |
| AI | Ollama (local, on `10.3.8.14`), Anthropic Claude, Google Gemini 2.5 (required — powers OCR) |
| Docs | python-docx-equivalent via JSZip token replace; PDF via LibreOffice headless |
| Lint | OxLint + Oxfmt |
| Infra | Docker Compose (`backend`, `frontend`, `cloudflared`) |

## Quick start (dev)

```bash
# 1. install Bun (one-time)
curl -fsSL https://bun.sh/install | bash

# 2. configure env
cp .env.example .env       # edit GOOGLE_API_KEY, ANTHROPIC_API_KEY, ADMIN_PASSWORD, JWT_SECRET

# 3. backend
cd server
bun install
bun run dev                # http://localhost:8787

# 4. frontend (new shell)
cd client
bun install
bun run dev                # http://localhost:5173
```

On first boot the backend will:
1. Create `server/data/minutes.db`
2. Run migrations
3. Seed admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
4. Seed `jkp` organization and `jkp/meeting-1` template (parsed from `server/templates/jkp/meeting-1.docx`)

## AI safety

- **Local (Ollama on `10.3.8.14`)** — safer for financial/PII data, slower.
- **Enterprise (Claude / Gemini / OpenAI)** — faster, more capable, but data leaves the network.
- The Sources step shows a persistent banner reminding users to **strip monetary values from imported files where possible** so enterprise providers can be used freely.
- OCR (PDF scans + images) always uses **Gemini 2.5 Flash** — same key is reused for chat as `gemini-2.5-pro`.

## Project layout

```
client/   React + Vite SPA (the wizard UI)
server/   Bun + Hono API (SQLite, JWT, AI, docx/pdf render)
server/templates/jkp/meeting-1.docx   the source-of-truth template
.env      single source of truth for every container/service
docker-compose.yml
```

## Deployment

```bash
docker compose up -d --build
```

Exposes the app via Cloudflare Tunnel when `CLOUDFLARE_TUNNEL_TOKEN` is set.

## Adding a new meeting template

1. Drop the new `.docx` into `server/templates/<org-slug>/<meeting-slug>.docx`
2. Add a row to `meeting_templates` (or restart — the seeder picks up any `templates/*/*.docx` that isn't yet registered)
3. The template parser auto-derives sections from heading paragraphs and `<placeholder>` tokens — no code change needed for standard formats. Custom logic per section can be added in `server/src/services/prompts/<section_key>.ts`.
