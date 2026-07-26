# Stock Metadata AI

**Professional AI image analysis for stock marketplaces.** Upload up to 10 images and get marketplace-ready titles, descriptions, 50 keywords, categories, and quality scores for Adobe Stock, Shutterstock, iStock, Freepik, and Dreamstime — powered by Google's Gemini API.

Built with plain HTML5, Tailwind CSS, and vanilla JavaScript on the frontend, and a single secure Vercel serverless function on the backend. No React, no Next.js, no build step.

---

## ⚠️ Before you deploy: a model note

This project was built to use **`gemini-2.5-flash`**, exactly as specified. As of this writing, Google has marked that model **deprecated, with a shutdown date of October 16, 2026**, in favor of `gemini-3.5-flash`. It still works today, but it will stop working on that date.

The model name lives in exactly one place: the `GEMINI_MODEL` constant at the top of `api/analyze.js`. To upgrade, change that one line:

```js
const GEMINI_MODEL = 'gemini-3.5-flash'; // was 'gemini-2.5-flash'
```

The request and response format is identical across model versions, so nothing else needs to change. Check [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations) for the current status before you go live.

---

## Features

- **Batch analysis** — up to 10 images per batch, analyzed one at a time with a live progress indicator
- **24 metadata fields per image** — title, short & long description, 50 keywords, category, subcategory, Adobe Stock / Shutterstock / Freepik category mapping, style, subject, mood, colors, composition, lighting, orientation, copy space, commercial use suggestions, editorial-or-commercial call, best marketplace recommendation, and four quality scores (SEO, keyword quality, metadata quality, AI confidence)
- **Copy tools** — copy metadata, keywords, description, or everything in one click
- **Export** — TXT, CSV, and JSON, per image or for the whole batch
- **Drag-and-drop upload** with client-side image resizing (keeps uploads fast and requests small)
- **Retry per image** — a single failed image doesn't require re-running the whole batch
- **Dark mode / light mode**, fully responsive, keyboard accessible
- **No database** — the API is stateless; nothing is stored server-side

---

## Tech stack

| Layer | Technology |
|---|---|
| Markup | HTML5 |
| Styling | Tailwind CSS v4 (Play CDN — zero build step) + a small custom stylesheet |
| Frontend logic | Vanilla JavaScript (ES6+), no framework |
| Backend | Vercel Serverless Function (Node.js) |
| AI | Google Gemini API (`gemini-2.5-flash`) |
| Hosting | Vercel |

---

## Screenshots

> Add your own screenshots after your first deploy! Create a `/screenshots` folder in the repo, drop your images in, and update the paths below.

| Homepage | Upload |
|---|---|
| `screenshots/home.png` | `screenshots/upload.png` |

| Results dashboard | Dark mode |
|---|---|
| `screenshots/dashboard.png` | `screenshots/dark-mode.png` |

---

## Project structure

```
stock-metadata-ai/
├── index.html          # Full page: hero, upload, dashboard, features, pricing, FAQ, footer
├── styles.css           # Custom design system (glassmorphism, animations, components)
├── script.js             # All frontend logic — upload, resize, analyze, render, export
├── api/
│   └── analyze.js        # Serverless function: calls Gemini, returns normalized metadata
├── vercel.json            # Function config + security headers
├── package.json
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

---

## Getting started locally

**Prerequisites:** Node.js 18+, a Vercel account, and a Gemini API key.

### 1. Get a Gemini API key

Create one for free at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

### 2. Install the Vercel CLI

```bash
npm install -g vercel
```

### 3. Set your environment variable

Copy the example file and add your key:

```bash
cp .env.example .env
```

Edit `.env`:

```
GEMINI_API_KEY=your_actual_key_here
```

### 4. Run it locally

```bash
vercel dev
```

This serves `index.html` and runs `api/analyze.js` as a real serverless function locally, so the full flow — upload, analyze, export — works exactly like production. Visit the URL it prints (usually `http://localhost:3000`).

---

## Deploy to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new repository on GitHub (via the website or `gh repo create`), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

`.env` is already excluded via `.gitignore` — your real API key never gets committed.

---

## Deploy to Vercel

### Option A — Vercel dashboard

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub repository.
2. Vercel will detect it as a static project with an `/api` function automatically — no build configuration needed.
3. Before deploying (or right after, then redeploy), go to **Project Settings → Environment Variables** and add:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** your Gemini API key
   - **Environments:** Production, Preview, and Development
4. Deploy. Your app is live at `your-project.vercel.app`.

### Option B — Vercel CLI

```bash
vercel
vercel env add GEMINI_API_KEY
vercel --prod
```

That's it — no build step, no framework detection issues, no extra configuration.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key. Read only on the server, in `api/analyze.js`. Never exposed to the browser. |

---

## How it works

1. **Upload** — you drag in up to 10 JPG/PNG/WEBP images. Each one is resized in the browser (long edge capped at 1568px, re-encoded as JPEG) before anything is sent anywhere. This keeps uploads fast and requests well under serverless payload limits.
2. **Analyze** — `script.js` calls `POST /api/analyze` once per image, sequentially. The serverless function sends the image to Gemini with a strict JSON response schema (24 fields), so the model's output is always structured and parseable — no fragile regex-parsing of free-form text.
3. **Review & export** — results render as expandable cards. Copy individual fields, or export the whole batch as TXT, CSV, or JSON formatted for a marketplace bulk uploader.

### Why the legacy `generateContent` endpoint, not the newer Interactions API?

Google's Interactions API is built for stateful, multi-turn, agentic workflows. This app does one thing: send one image, get one structured JSON result back, no memory needed between calls. Google's own guidance is to keep using `generateContent` for exactly this kind of stateless, production workload — so that's what `api/analyze.js` uses.

---

## Customization

- **Change the AI model:** edit the `GEMINI_MODEL` constant in `api/analyze.js`.
- **Change the prompt or schema:** both live in `api/analyze.js`, in `buildPrompt()` and `buildResponseSchema()`. Add or remove fields there, then update the rendering functions in `script.js` (`resultDetailsHtml`, `buildTxtBlock`, `CSV_COLUMNS`) to match.
- **Change the batch size:** `MAX_IMAGES` in `script.js`.
- **Change the color palette or fonts:** the `@theme` block at the top of `index.html` — every color and font in the app is driven from those CSS variables.
- **Add inline editing:** results currently render as read-only. A natural next step is making the title/description fields editable (e.g. `contenteditable` or swapping to `<input>`/`<textarea>`) before export.

---

## Production considerations

- **Rate limiting:** this endpoint has no built-in rate limiter. If you expect public traffic, add one (e.g. Vercel Firewall rules, or an edge-compatible store like Upstash Redis) so a single visitor can't exhaust your Gemini quota.
- **Cost:** Vercel's free tier is normally enough for personal use. Gemini API usage is billed separately by Google — check current pricing before running large batches.
- **CORS:** intentionally not enabled. The frontend and API share an origin, so no cross-origin requests are needed, and leaving CORS closed keeps other sites from calling your endpoint and spending your quota.
- **No database:** by design. If you want to save history across sessions, you'll need to add your own storage (e.g. Vercel Postgres, Supabase).

---

## Browser support

Requires a browser released in the last ~2-3 years (Chrome 111+, Safari 16.4+, Firefox 128+, or equivalent Edge) — this is set by Tailwind CSS v4's own requirements, not by anything in this app's code.

---

## License

MIT — see [LICENSE](./LICENSE). Use it, modify it, ship it as your own product.

## Credits

- [Google Gemini API](https://ai.google.dev/gemini-api/docs) for image analysis
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Vercel](https://vercel.com) for hosting
