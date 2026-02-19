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
app.use(express.static(path.join(__dirname, 'public')));

// Simple request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Helper to generate PDF from templates
async function generatePDFFromTemplates(reportData) {
    // Launch Puppeteer
    let browser;
    try {
        console.log('Launching Puppeteer...');
        const launchOptions = {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--allow-file-access-from-files'],
            defaultViewport: { width: 1920, height: 1080 },
            headless: true,
        };

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

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    await page.setCacheEnabled(false);

    const pdfs = [];
    const files = ['summary.html', 'ownership.html', 'terms2.html'];
    
    for (const file of files) {
        console.log(`Generating PDF for ${file}...`);
        const absPath = path.resolve(__dirname, 'public', 'js', file);
        const filePath = `file:///${absPath.replace(/\\/g, '/')}`;
        
        await page.goto(filePath, { waitUntil: 'load' });
        
        // Inject data and trigger sync
        await page.evaluate((data) => {
            window.reportData = data;
            if (typeof syncReport === 'function') {
                syncReport();
            } else {
                console.warn('syncReport not found on page');
            }
        }, reportData);

        // Give extra time for charts
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
app.post('/send-email', (req, res) => {
    const { to_email, pdfBase64, summaryData, reportData } = req.body;

    if (!to_email || (!pdfBase64 && !reportData)) {
        return res.status(400).json({ success: false, message: 'Missing email, PDF data, or report data' });
    }

    // Respond immediately to the user
    res.json({ success: true, message: 'Your report is being generated and will be emailed shortly!' });

    // Process in the background
    (async () => {
        try {
            console.log(`[Background Queue] Processing email for ${to_email}...`);
            let finalPdfBase64 = pdfBase64;
            if (!finalPdfBase64 && reportData) {
                console.log(`[Background Queue] Generating PDF first for ${to_email}...`);
                finalPdfBase64 = await generatePDFFromTemplates(reportData);
            }
            console.log(`[Background Queue] Generating email content for ${to_email}...`);
            const info = await sendPDFReport(to_email, finalPdfBase64, summaryData);
            console.log(`[Background Queue] Email sent successfully to: ${to_email} | MessageId: ${info.messageId}`);
        } catch (error) {
            console.error(`[Background Queue] SEVERE ERROR for ${to_email}:`, error.message);
            console.error(error.stack);
        }
    })();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
