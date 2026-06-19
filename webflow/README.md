# SAFE Calculator → Webflow (production)

These three files are generated from `../index.html` by `../build-webflow.mjs`.
**Do not edit them by hand** — edit `index.html`, then re-run:

```
node build-webflow.mjs
```

| File | What it is | Where it goes |
|------|------------|---------------|
| `embed.html` | Body markup + `<link>`/`<script>` tags | Paste into a Webflow **Embed** element |
| `style.css` | All CSS, scoped under `.safe-calculator-widget` | Served via jsDelivr |
| `script.js` | All calculator JS | Served via jsDelivr |

---

## 1. Publish the assets (jsDelivr)

`style.css` and `script.js` are loaded from jsDelivr, which serves files
straight from GitHub. They must live in the repo at the path the embed expects:

```
github.com/Vigneshshankaran/Safe-calculator-backend  →  /webflow/style.css, /webflow/script.js
```

Steps:

1. Commit the `webflow/` folder to that repo and push to `main`.
2. The jsDelivr URLs are:
   - `https://cdn.jsdelivr.net/gh/Vigneshshankaran/Safe-calculator-backend@main/webflow/style.css`
   - `https://cdn.jsdelivr.net/gh/Vigneshshankaran/Safe-calculator-backend@main/webflow/script.js`

**Caching / versioning (important):**
- `@main` is cached by jsDelivr for ~12 hours. After you push an update, either:
  - **Purge:** open `https://purge.jsdelivr.net/gh/Vigneshshankaran/Safe-calculator-backend@main/webflow/style.css` (and the `.js`) in a browser, **or**
  - **Pin a version (recommended for production):** create a git tag (`git tag v1.0.0 && git push --tags`), then set `TAG = 'v1.0.0'` in `build-webflow.mjs`, re-run it, and re-paste `embed.html`. Tagged URLs are immutable and cached forever — no stale-cache surprises.

---

## 2. Webflow page setup

1. Create the dedicated SAFE-calculator page (with your normal Webflow nav + footer).
2. Add an **Embed** element where the calculator should appear.
3. Paste the entire contents of `embed.html` into it.
4. Make sure the page keeps Webflow's default `<meta charset="utf-8">` (it does by
   default) — this is what renders the “—” dashes and other symbols correctly.
5. Publish.

> Put the `<link>`/`<script>` **only** in this embed (or this page's custom code),
> **never** in site-wide settings — that keeps the calculator's CSS off every
> other page. All CSS is already scoped under `.safe-calculator-widget`.

⚠️ **One-way isolation:** the calculator's styles won't leak out, but Webflow's
global styles (body font/links) can still partially cascade *in*. If something
looks off, the only airtight fix is an iframe — ask and I'll switch it.

---

## 3. Backend (Render) — required env vars

Set these in **Render → your service → Environment** (not in the repo):

```
NODE_ENV=production
ALLOWED_ORIGINS=https://<your-webflow-domain>,https://<your-site>.webflow.io
```

- `ALLOWED_ORIGINS` must list every domain the calculator page is published on.
- **No trailing slash, no path** — must be bare origins, e.g.
  `https://www.equitylist.co` (NOT `https://www.equitylist.co/`).
- Without this, CORS is wide open (the server logs a warning at boot).

---

## 4. Confirm the backend URL

`script.js` calls the PDF backend at:

```
const BASE_URL = "https://safe-calculator-backend.onrender.com";
```

Open `https://safe-calculator-backend.onrender.com/health` — it should return
`{"status":"ok",...}`. If your Render URL differs, fix `BASE_URL` in
`../index.html`, re-run the build, and re-publish.

---

## 5. Lead capture (Webflow native form) — TODO, needs your form

`WEBFLOW_FORM_ENDPOINT` in `script.js` is currently empty, so leads aren't
captured yet. Webflow native forms don't accept arbitrary JSON POSTs, so the
reliable pattern is a **hidden Webflow form on the same page**:

1. Add a normal Webflow Form to the calculator page; set it to display:none.
2. Give its fields names matching `WEBFLOW_FIELDS` in `script.js`
   (First-Name, Last-Name, Email, Company, Subscribe).
3. Replace `postLeadToWebflow()` to populate and `.submit()` that form instead
   of `fetch()`-ing JSON.

Send me the form's field names / form ID and I'll wire this up.
