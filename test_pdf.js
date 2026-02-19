const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function testPDF() {
    console.log("Starting PDF generation test...");
    let browser;
    try {
        console.log("Launching browser...");
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--allow-file-access-from-files'],
            headless: true
        });
        console.log("Browser launched.");
        
        const page = await browser.newPage();
        console.log("New page created.");
        
        const testFilePath = 'file:///' + path.resolve(__dirname, 'public', 'js', 'ownership.html').replace(/\\/g, '/');
        console.log("Navigating to:", testFilePath);
        
        await page.goto(testFilePath, { waitUntil: 'load' });
        console.log("Page loaded.");
        
        const pdf = await page.pdf({
            printBackground: true,
            width: '1920px',
            height: '1080px',
        });
        console.log("PDF generated. Size:", pdf.length);
        
        fs.writeFileSync('test_output.pdf', pdf);
        console.log("Saved to test_output.pdf");
        
    } catch (err) {
        console.error("PDF generation failed!", err);
    } finally {
        if (browser) await browser.close();
    }
}

testPDF();
