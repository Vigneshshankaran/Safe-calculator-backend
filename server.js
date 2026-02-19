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

let browserInstance = null;

// Initialize Puppeteer once
async function initBrowser() {
    try {
        console.log('Starting persistent browser instance...');
        const launchOptions = {
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-web-security', 
                '--allow-file-access-from-files',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            defaultViewport: { width: 1920, height: 1080 },
            headless: true,
        };

        if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log(`Using custom executablePath: ${launchOptions.executablePath}`);
        }

        browserInstance = await puppeteer.launch(launchOptions);
        console.log('Browser initialized and ready.');
        
        // Handle unexpected exits
        browserInstance.on('disconnected', () => {
            console.log('Browser disconnected, restarting...');
            initBrowser();
        });
    } catch (error) {
        console.error('Failed to initialize browser:', error.message);
    }
}

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
    const browser = browserInstance || (await initBrowser(), browserInstance);
    if (!browser) throw new Error('Browser not initialized');

    const pagePromises = ['summary.html', 'ownership.html', 'terms2.html'].map(async (file) => {
        const page = await browser.newPage();
        
        // Inject report data directly into the page's global scope
        // This avoids disk writes and fixes race conditions
        const dataScript = `window.reportData = ${JSON.stringify(reportData)};`;
        
        // Disable cache for this request
        await page.setCacheEnabled(false);
        
        const absPath = path.resolve(__dirname, 'public', 'js', file);
        const filePath = `file:///${absPath.replace(/\\/g, '/')}`;
        
        console.log(`Navigating to ${file}...`);
        // Navigate first
        await page.goto(filePath, { waitUntil: 'load' });
        
        // THEN inject the script tag
        await page.addScriptTag({ content: dataScript });
        
        // Simple log forwarding
        page.on('console', msg => console.log(`PAGE LOG [${file}]:`, msg.text()));
        
        // Trigger the syncReport function if it exists on the page
        await page.evaluate(() => {
            if (typeof syncReport === 'function') syncReport();
        });

        // Minimal delay for Chart.js rendering (animations are disabled)
        await new Promise(r => setTimeout(r, 150));

        const pdf = await page.pdf({
            printBackground: true,
            width: '1920px',
            height: '1080px',
        });
        
        await page.close();
        return pdf;
    });

    const pdfs = await Promise.all(pagePromises);
    console.log('All PDF segments generated in parallel.');

    // Merge PDFs
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

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    await initBrowser();
});
