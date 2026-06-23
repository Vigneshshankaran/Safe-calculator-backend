require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3005;

// Behind a platform proxy (Railway/Nginx) so req.ip reflects the real client.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------

// CORS allowlist. Set ALLOWED_ORIGINS="https://app.example.com,https://example.com"
// in the environment for production. If unset, all origins are allowed (dev only).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, cb) {
        // Allow same-origin / server-to-server (no Origin header) and dev (empty allowlist).
        if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
            return cb(null, true);
        }
        return cb(new Error('Origin not allowed by CORS'));
    },
}));

// Minimal hardening headers (dependency-free).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// reportData is small JSON; cap the body to prevent abuse.
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logger.
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Simple in-memory, per-IP rate limiter (no external dependency).
function rateLimit({ windowMs, max }) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        // Opportunistic cleanup so the map can't grow unbounded.
        if (hits.size > 5000) {
            for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
        }
        const ip = req.ip || 'unknown';
        let rec = hits.get(ip);
        if (!rec || now > rec.reset) {
            rec = { count: 0, reset: now + windowMs };
            hits.set(ip, rec);
        }
        rec.count++;
        if (rec.count > max) {
            const retryAfter = Math.ceil((rec.reset - now) / 1000);
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({ success: false, message: 'Too many requests, please try again later.' });
        }
        next();
    };
}

// ---------------------------------------------------------------------------
// Puppeteer — single shared browser instance, reused across requests.
// ---------------------------------------------------------------------------
let _browser = null;
let _launching = null;

async function launchBrowser() {
    // Determine the executable path, checking environment variables, local system fallbacks for dev,
    // and finally @sparticuz/chromium for serverless/container environments.
    let execPath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    
    if (!execPath) {
        if (process.platform === 'win32') {
            const winPaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            ];
            for (const p of winPaths) {
                if (fs.existsSync(p)) {
                    execPath = p;
                    break;
                }
            }
        } else if (process.platform === 'darwin') {
            const macPaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ];
            for (const p of macPaths) {
                if (fs.existsSync(p)) {
                    execPath = p;
                    break;
                }
            }
        }
    }

    if (!execPath) {
        execPath = await chromium.executablePath();
    }

    console.log(`Launching browser with executablePath: ${execPath}`);

    // If using a local system browser, use standard launching parameters,
    // otherwise use @sparticuz/chromium parameters.
    const isLocalSystemBrowser = execPath && (
        execPath.includes('Google') || 
        execPath.includes('Microsoft') || 
        execPath.includes('Edge') || 
        execPath.includes('Chrome') || 
        execPath.includes('chrome.exe') || 
        execPath.includes('msedge.exe')
    );
    
    const launchArgs = isLocalSystemBrowser 
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'];

    const headlessMode = isLocalSystemBrowser ? true : chromium.headless;

    return await puppeteer.launch({
        args: launchArgs,
        defaultViewport: { width: 1920, height: 1080 },
        executablePath: execPath,
        headless: headlessMode,
    });
}

async function getBrowser() {
    if (_browser && _browser.isConnected()) return _browser;
    if (!_launching) {
        _launching = launchBrowser()
            .then((b) => {
                _browser = b;
                _browser.on('disconnected', () => { _browser = null; });
                return b;
            })
            .finally(() => { _launching = null; });
    }
    return _launching;
}

// Render a single report template to a PDF buffer in its own tab.
async function renderTemplateToPdf(browser, file, reportData) {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error(`PAGE ERROR (${file}):`, err.message));
    // Reuse cached static assets (Google Fonts CSS/woff, chart.js, tailwind.js)
    // across renders instead of re-fetching/re-parsing them every time.
    await page.setCacheEnabled(true);
    // Bound every page operation so a misbehaving render can't hold a slot forever.
    page.setDefaultNavigationTimeout(20000);
    page.setDefaultTimeout(20000);

    try {
        const absPath = path.resolve(__dirname, 'public', 'js', file);
        const filePath = `file:///${absPath.replace(/\\/g, '/')}`;
        await page.goto(filePath, { waitUntil: 'load' });

        // report-config.js declares `const reportData = {...defaults...}` as a
        // top-level lexical binding (not window.reportData). syncReport() reads
        // that binding, so we mutate it in place, then re-render.
        await page.evaluate((data) => {
            try {
                if (typeof reportData === 'object' && reportData) {
                    Object.keys(reportData).forEach((k) => { delete reportData[k]; });
                    Object.assign(reportData, data);
                }
            } catch (e) {
                console.warn('Could not patch reportData binding:', e.message);
            }
            window.reportData = data;
            if (typeof syncReport === 'function') syncReport();
            else console.warn('syncReport not found on page');
        }, reportData);

        // Wait for an explicit render-complete signal instead of a fixed sleep.
        await page.waitForFunction('window.__renderDone === true', { timeout: 5000 }).catch(() => {
            console.warn(`Render signal not received for ${file}; proceeding.`);
        });
        // Ensure web fonts are ready, then a short settle for canvas paint.
        try { await page.evaluate(() => (document.fonts ? document.fonts.ready : null)); } catch (e) { /* noop */ }
        await new Promise((r) => setTimeout(r, 250));

        // Grow any marked "slide" to fit its content — done here, AFTER fonts
        // are ready, so the measured layout is final (pre-font measurement
        // would under-size the page and clip reflowed text).
        await page.evaluate(() => { if (typeof fitPageHeight === 'function') fitPageHeight(); }).catch(() => {});

        // Pages are 1920x1080 "slides", but the cap-table page grows with the
        // number of shareholders. Render at the content's natural height so
        // nothing is clipped; pages that fit stay at the standard 1080.
        const contentHeight = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
        const pageHeight = Math.max(1080, contentHeight);
        return await page.pdf({ printBackground: true, width: '1920px', height: `${pageHeight}px` });
    } finally {
        // Close only the page; the browser is reused for the next request.
        await page.close().catch(() => {});
    }
}

async function generatePDFFromTemplates(reportData) {
    const browser = await getBrowser();
    const files = ['summary.html', 'ownership.html', 'terms2.html'];

    // Render all three pages concurrently (one tab each). Promise.all preserves
    // input order, so the merge stays summary → ownership → terms. Wall-clock
    // drops from the sum of three renders to roughly the slowest single one.
    const pdfs = await Promise.all(
        files.map((file) => renderTemplateToPdf(browser, file, reportData))
    );

    const mergedPdf = await PDFDocument.create();
    for (const pdfBytes of pdfs) {
        const doc = await PDFDocument.load(pdfBytes);
        const copied = await mergedPdf.copyPages(doc, doc.getPageIndices());
        copied.forEach((pg) => mergedPdf.addPage(pg));
    }
    const mergedPdfBytes = await mergedPdf.save();
    return Buffer.from(mergedPdfBytes).toString('base64');
}

// ---------------------------------------------------------------------------
// Concurrency limiter — PDF rendering is CPU/memory heavy, so cap how many run
// at once (the rest queue). Prevents many simultaneous requests from exhausting
// the container's memory. NOTE: each job now opens 3 tabs in parallel (one per
// template), so peak tabs ≈ MAX_CONCURRENT × 3 — on a small (512MB) instance
// keep this at 2. Tune with MAX_CONCURRENT_PDFS.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_PDFS || '2', 10));
const QUEUE_WAIT_MS = 20000; // max time a request waits for a free slot
let activeJobs = 0;
const queue = [];

function acquireSlot() {
    return new Promise((resolve, reject) => {
        if (activeJobs < MAX_CONCURRENT) {
            activeJobs++;
            return resolve();
        }
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
            const i = queue.indexOf(waiter);
            if (i >= 0) queue.splice(i, 1);
            reject(new Error('busy'));
        }, QUEUE_WAIT_MS);
        queue.push(waiter);
    });
}

function releaseSlot() {
    const next = queue.shift();
    if (next) {
        clearTimeout(next.timer);
        next.resolve(); // hand the slot off; activeJobs stays the same
    } else {
        activeJobs--;
    }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        browser: !!(_browser && _browser.isConnected()),
        activeJobs,
        queued: queue.length,
    });
});

app.post('/generate-pdf', rateLimit({ windowMs: 60 * 1000, max: 10 }), async (req, res) => {
    // Lead capture is handled by the Webflow form, not the backend — any
    // leadData/to_email fields in the body are ignored.
    const { reportData } = req.body || {};
    if (!reportData) {
        return res.status(400).json({ success: false, message: 'Missing report data' });
    }

    try {
        await acquireSlot();
    } catch (e) {
        return res.status(503).json({ success: false, message: 'Server busy, please try again shortly.' });
    }

    console.log('Incoming Rows Count:', reportData.rows ? reportData.rows.length : 0, '| Round:', reportData.roundName);

    try {
        const pdfBase64 = await generatePDFFromTemplates(reportData);
        console.log('PDF generation complete (Base64 length:', pdfBase64.length, ')');
        res.json({ success: true, pdfBase64 });
    } catch (error) {
        console.error('Error in /generate-pdf endpoint:', error);
        res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    } finally {
        releaseSlot();
    }
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.length === 0) {
        console.warn('WARNING: ALLOWED_ORIGINS is not set — CORS is open to all origins. Set it in production.');
    }
    console.log(`PDF concurrency limit: ${MAX_CONCURRENT}`);

    // Pre-warm Chromium at boot so the first PDF request doesn't pay the
    // browser-launch cost (~3-5s). On Render this runs while the container is
    // waking, so by the time the first request lands the browser is ready.
    getBrowser()
        .then(() => console.log('Browser pre-warmed and ready.'))
        .catch((e) => console.warn('Browser pre-warm failed (will retry on first request):', e.message));
});

// Graceful shutdown — close the shared browser and the HTTP server.
async function shutdown(signal) {
    console.log(`Received ${signal}, shutting down...`);
    try { if (_browser) await _browser.close(); } catch (e) { /* noop */ }
    server.close(() => process.exit(0));
    // Failsafe if connections hang.
    setTimeout(() => process.exit(0), 5000).unref();
}
['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
