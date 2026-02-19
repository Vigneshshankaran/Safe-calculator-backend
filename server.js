require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const { sendPDFReport, saveLead } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Simple request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Helper to generate PDF from templates
async function generatePDFFromTemplates(reportData) {
    // 1. Write data to report-config.js
    const configPath = path.join(__dirname, 'public', 'js', 'report-config.js');
    const configContent = `const reportData = ${JSON.stringify(reportData, null, 2)};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.innerText = value;
  } else {
    console.warn("Element not found for ID:", id);
  }
}

function syncReport() {
  if (typeof reportData === 'undefined' || !reportData) {
    console.error("No reportData found");
    return;
  }
  console.log("Syncing report data for:", reportData.roundName, "at", reportData.timestamp);

  const timestampEls = document.querySelectorAll(".timestamp-value");
  timestampEls.forEach(el => {
      if (!el.dataset.synced) {
        el.innerText = reportData.timestamp || "";
        el.dataset.synced = "true";
      }
  });

  const roundNameEls = document.querySelectorAll(".display-round-name");
  roundNameEls.forEach(el => {
      el.innerText = reportData.roundName || "Series A";
  });

  if (reportData.summary) {
    setText("outcome-ownership", reportData.summary.ownershipPost);
    setText("outcome-dilution", reportData.summary.dilution);
    setText("outcome-postmoney", reportData.summary.postMoney);
    setText("outcome-pps", reportData.summary.pricePerShare);
    setText("outcome-totalshares", reportData.summary.totalShares);

    setText("bar-pre-pct", reportData.summary.ownershipPre);
    setText("bar-post-pct", reportData.summary.ownershipPost);
    setText("bar-pre-label", "Before " + (reportData.roundName || "Series A"));
    setText("bar-post-label", "After " + (reportData.roundName || "Series A"));

    const preLabel = document.getElementById("bar-pre-pct");
    const postLabel = document.getElementById("bar-post-pct");
    
    if (preLabel && reportData.summary.ownershipPre) {
        const hPre = parseFloat(reportData.summary.ownershipPre.replace('%', ''));
        preLabel.style.top = (805 - (hPre * 7.4)) + "px";
    }
    if (postLabel && reportData.summary.ownershipPost) {
        const hPost = parseFloat(reportData.summary.ownershipPost.replace('%', ''));
        postLabel.style.top = (805 - (hPost * 7.4)) + "px";
    }
  }

  const tableBody = document.getElementById("table-body");
  if (tableBody && reportData.rows) {
    let totalPre = 0;
    let totalPost = 0;
    reportData.rows.forEach(r => { totalPre += (r.preShares || 0); totalPost += (r.postShares || 0); });

    const pps = (reportData.summary && reportData.summary.pricePerShare) ? reportData.summary.pricePerShare : "—";

    tableBody.innerHTML = reportData.rows.map(row => {
      return \`
      <div class="grid grid-cols-[1fr_250px_250px_150px_150px_150px] h-[50px] items-center px-[30px] border-b border-[#D2D2D2]">
        <div class="flex items-center">
          <span class="text-[25px] font-semibold text-[#0d0d0d] tracking-[-0.75px] truncate">\${row.name}</span>
          \${(row.badge && !row.isInvestor) ? \`<span class="inline-flex items-center px-1.5 py-0.5 rounded-[7px] border \${row.badgeStyle || ""} text-[15px] font-semibold tracking-[-0.45px] leading-[0.9] ml-2 whitespace-nowrap">\${row.badge}</span>\` : ""}
        </div>
        <span class="text-[25px] font-semibold text-[#6c6c6c] tracking-[-0.75px] text-right">\${(row.preShares || 0).toLocaleString()}</span>
        <span class="text-[25px] font-semibold text-[#0d0d0d] tracking-[-0.75px] text-right">\${(row.postShares || 0).toLocaleString()}</span>
        <span class="text-[25px] font-semibold text-[#6c6c6c] tracking-[-0.75px] text-right">\${(( (row.preShares || 0) / (totalPre || 1)) * 100).toFixed(2)}%</span>
        <span class="text-[25px] font-semibold text-[#0d0d0d] tracking-[-0.75px] text-right">\${(( (row.postShares || 0) / (totalPost || 1)) * 100).toFixed(2)}%</span>
        <span class="text-[25px] font-semibold text-[#6c6c6c] tracking-[-0.75px] text-right">\${(row.preShares || 0) > 0 ? pps : "—"}</span>
      </div>
    \`;}).join("");
    
    setText("total-pre", totalPre.toLocaleString());
    setText("total-post", totalPost.toLocaleString());
  }

  const interpEl = document.getElementById("interpretation-content");
  if (interpEl && reportData.rows && reportData.summary) {
    const founderPost = reportData.rows.filter(r => r.isFounder).reduce((s, r) => s + (r.postShares || 0), 0);
    const totalPost = reportData.rows.reduce((s, r) => s + (r.postShares || 0), 0);
    const founderPct = ((founderPost / (totalPost || 1)) * 100).toFixed(2);
    const rName = reportData.roundName || "Series A";

    interpEl.innerHTML = \`
      <p>You are modeling a \${rName} round raising \${reportData.summary.totalRaised} at a \${reportData.summary.postMoney} post-money valuation. Founder ownership changes from \${reportData.summary.ownershipPre} to \${founderPct}% post \${rName}.</p>
      <p class="mt-4">\${reportData.rows.filter(r => r.isSafe).length} SAFE(s) totaling \${reportData.safeAmount || 0} will convert.</p>
    \`;
  }

  if (reportData.summary) {
    setText("term-valuation", reportData.summary.postMoney);
    setText("term-raising", reportData.summary.totalRaised);
    setText("term-optionpool", reportData.optionPool);
    setText("term-roundname", reportData.roundName || "Series A");
    setText("ownership-round-label", (reportData.roundName || "Series A") + " SUMMARY");
  }

  const safeBody = document.getElementById("safe-breakdown-body");
  if (safeBody && reportData.rows) {
    const safes = reportData.rows.filter(r => r.isSafe);
    safeBody.innerHTML = safes.map((s, i) => {
        const rowTop = 261 + (i * 45);
        const lineTop = rowTop + 28;
        let html = \`<div class="absolute contents font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[0.9] text-[#0d0d0d] text-[15px] tracking-[-0.45px]">\`;
        html += \`<div class="absolute left-[30px] top-[\${rowTop}px] flex items-center">\`;
        html += \`<span>\${s.name}</span>\`;
        if (s.badge) {
            html += \`<span class="inline-flex items-center px-1.5 py-0.5 rounded-[7px] border \${s.badgeStyle || ""} text-[10px] font-semibold tracking-[-0.3px] leading-[0.9] ml-2 whitespace-nowrap">\${s.badge}</span>\`;
        }
        html += \`</div>\`;
        html += \`<p class="-translate-x-full absolute left-[410px] text-right top-[\${rowTop}px]">\${(s.investment || 0).toLocaleString()}</p>\`;
        html += \`<p class="-translate-x-full absolute left-[619px] text-right top-[\${rowTop}px]">\${(s.cap || 0).toLocaleString()}</p>\`;
        html += \`<p class="-translate-x-full absolute left-[788px] text-right top-[\${rowTop}px]">\${s.discount || "None"}</p>\`;
        html += \`<p class="-translate-x-full absolute left-[918px] text-right top-[\${rowTop}px]">\${s.type || "N/A"}</p>\`;
        html += \`<div class="absolute h-0 left-[26px] top-[\${lineTop}px] w-[912px]"><div class="absolute inset-[-0.25px_0]"><svg class="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 912 0.5"><path d="M0 0.25H912" stroke="#D2D2D2" stroke-width="0.5"></path></svg></div></div>\`;
        html += \`</div>\`;
        return html;
    }).join("");

    const totalSafeInv = safes.reduce((sum, s) => sum + (s.investment || 0), 0);
    setText("safe-total-investment", "$" + totalSafeInv.toLocaleString());
  }

  const investorBody = document.getElementById("round-investors-body");
  if (investorBody && reportData.rows) {
    const investors = reportData.rows.filter(r => r.isInvestor);
    investorBody.innerHTML = investors.map((inv, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const left = col === 0 ? 970 : 1445;
        const top = 195 + (row * 60);
        let html = \`<div class="absolute left-[\${left}px] top-[\${top}px] w-[465px] h-[55px] bg-[#eeebfb] border border-[#4039a8] border-solid flex items-center px-[10px] justify-between">\`;
        html += \`<div class="flex items-center">\`;
        html += \`<p class="font-semibold text-[#4039a8] text-[15px]">\${inv.name}</p>\`;
        html += \`</div>\`;
        html += \`<p class="font-semibold text-[#4039a8] text-[15px]">\${(inv.investment || 0).toLocaleString()}</p>\`;
        html += \`</div>\`;
        return html;
    }).join("");
  }

  console.log("Text sync complete. Starting charts...");
  renderCharts();
}

function renderCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js not loading - waiting...");
        setTimeout(renderCharts, 100);
        return;
    }
    console.log("Chart.js ready. Rendering charts with rows:", reportData.rows?.length);

    const rows = reportData.rows || [];
    const totalPost = rows.reduce((s, r) => s + (r.postShares || 0), 0);
    
    // 1. Doughnut Chart
    const pieCanvas = document.getElementById('pieChartCanvas');
    if (pieCanvas && rows.length > 0) {
        const existingChart = Chart.getChart(pieCanvas);
        if (existingChart) existingChart.destroy();

        const labels = rows.map(r => r.name);
        const data = rows.map(r => r.postShares);
        
        const categoryPalettes = {
            "Founder": ["#5F17EA", "#7C3AED", "#9333EA", "#A855F7", "#C084FC", "#D8B4FE"],
            "Investor": ["#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#2563EB", "#1D4ED8"],
            "Series Investor": ["#06B6D4", "#22D3EE", "#67E8F9", "#A5F3FC"],
            "SAFE Converter": ["#10B981", "#34D399", "#6EE7B7", "#A7F3D0"],
            "ESOP": ["#FACC15", "#FDE047", "#FEF08A"],
            "Other": ["#64748B", "#94A3B8", "#CBD5E1"]
        };

        const categoryCounters = {};
        const backgroundColors = rows.map(r => {
            let cat = "Other";
            if (r.isFounder) cat = "Founder";
            else if (r.isInvestor) cat = "Investor";
            else if (r.isSafe) cat = "SAFE Converter";
            else if (r.badge === "ESOP") cat = "ESOP";
            
            if (!categoryCounters[cat]) categoryCounters[cat] = 0;
            const palette = categoryPalettes[cat] || categoryPalettes["Other"];
            const color = palette[categoryCounters[cat] % palette.length];
            categoryCounters[cat]++;
            return color;
        });

        new Chart(pieCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: backgroundColors,
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });

        const legendContainer = document.getElementById('doughnut-legend');
        if (legendContainer) {
            legendContainer.innerHTML = rows.map((r, i) => {
                const pct = ((r.postShares / (totalPost || 1)) * 100).toFixed(1);
                if (parseFloat(pct) < 0.1) return ""; 
                return \`
                    <div class="flex items-center gap-2">
                        <div class="size-[12px] rounded-sm shrink-0" style="background-color: \${backgroundColors[i]}"></div>
                        <span class="text-[13px] font-bold text-[#494949] truncate">\${r.name} (\${pct}%)</span>
                    </div>
                \`;
            }).join("");
        }
    }

    // 2. Bar Chart
    const barCanvas = document.getElementById('barChartCanvas');
    if (barCanvas && reportData.summary) {
        const existingChart = Chart.getChart(barCanvas);
        if (existingChart) existingChart.destroy();

        const prePct = parseFloat((reportData.summary.ownershipPre || "0").replace('%', ''));
        const postPct = parseFloat((reportData.summary.ownershipPost || "0").replace('%', ''));

        const rName = reportData.roundName || "Series A";

        new Chart(barCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Before ' + rName, 'After ' + rName],
                datasets: [{
                    data: [prePct, postPct],
                    backgroundColor: ["#E5E5ED", "#5F17EA"],
                    borderRadius: 8,
                    barThickness: 60
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: { display: false, beginAtZero: true, min: 0, max: 100 },
                    x: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    }
}

document.addEventListener("DOMContentLoaded", syncReport);
if (document.readyState === "complete" || document.readyState === "interactive") {
    syncReport();
}
`;
    fs.writeFileSync(configPath, configContent);

    // 2. Launch Puppeteer
    let browser;
    try {
        console.log('Launching Puppeteer...');
        // Standard Puppeteer will use its own downloaded chromium or CHROME_PATH
        const launchOptions = {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--allow-file-access-from-files'],
            defaultViewport: { width: 1920, height: 1080 },
            headless: true,
        };

        // If a specific path is provided via env, use it
        if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log(`Using custom executablePath: ${launchOptions.executablePath}`);
        }

        browser = await puppeteer.launch(launchOptions);
        console.log('Successfully launched browser.');
    } catch (launchError) {
        console.error('Final Puppeteer launch failed:', launchError.message);
        throw new Error('Could not find or launch a valid Chrome/Chromium executable.');
    }

    const page = await browser.newPage();
    console.log('New page created.');

    // Debugging: Forward page logs to terminal
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    // Disable caching to ensure fresh report-config.js is loaded
    await page.setCacheEnabled(false);

    const pdfs = [];

    const files = ['summary.html', 'ownership.html', 'terms2.html'];
    for (const file of files) {
        console.log(`Generating PDF for ${file}...`);
        const absPath = path.resolve(__dirname, 'public', 'js', file);
        const filePath = `file:///${absPath.replace(/\\/g, '/')}`;
        await page.goto(filePath, { waitUntil: 'networkidle2' });
        
        // Give Chart.js enough time to render completely
        await new Promise(r => setTimeout(r, 2000));

        const pdf = await page.pdf({
            printBackground: true,
            width: '1920px',
            height: '1080px',
        });
        pdfs.push(pdf);
        console.log(`Successfully generated PDF for ${file}.`);
    }

    await browser.close();

    // 3. Merge PDFs
    const mergedPdf = await PDFDocument.create();
    for (const pdfBytes of pdfs) {
        const pdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedPdfBytes = await mergedPdf.save();
    return Buffer.from(mergedPdfBytes).toString('base64');
}



// PDF Generation Endpoint
app.post('/generate-pdf', async (req, res) => {
    const { reportData, leadData, to_email } = req.body;
    if (!reportData) {
        return res.status(400).json({ success: false, message: 'Missing report data' });
    }

    // Log lead if data provided (usually during Download flow)
    if (leadData && to_email) {
        saveLead(to_email, leadData);
    }

    console.log('Incoming Report Summary:', JSON.stringify(reportData.summary, null, 2));
    console.log('Incoming Rows Count:', reportData.rows ? reportData.rows.length : 0);
    console.log('Round Name:', reportData.roundName);

    try {
        console.log('Starting PDF generation for request...');
        const pdfBase64 = await generatePDFFromTemplates(reportData);
        console.log('PDF generation complete. Sending response (Base64 length:', pdfBase64.length, ')');
        res.json({ success: true, pdfBase64 });
    } catch (error) {
        console.error('Error in /generate-pdf endpoint:', error);
        res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }
});

// Email Endpoint
app.post('/send-email', async (req, res) => {
    const { to_email, pdfBase64, summaryData, reportData } = req.body;

    if (!to_email || (!pdfBase64 && !reportData)) {
        return res.status(400).json({ success: false, message: 'Missing email, PDF data, or report data' });
    }

    try {
        let finalPdfBase64 = pdfBase64;
        if (!finalPdfBase64 && reportData) {
            finalPdfBase64 = await generatePDFFromTemplates(reportData);
        }
        const info = await sendPDFReport(to_email, finalPdfBase64, summaryData);
        console.log('Email sent successfully to:', to_email, '| Info:', info.response);
        res.json({ success: true, message: 'Email sent successfully!' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send email. Check if your App Password is correct.' 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
