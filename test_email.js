require('dotenv').config();
const { sendPDFReport } = require('./mailer');

async function test() {
    console.log("Starting email test...");
    const to_email = "vignesh@equitylist.co";
    const pdfBase64 = "JVBERi0xLjQKJ...(placeholder)..."; // Dummy base64
    const summaryData = {
        firstName: "Test",
        lastName: "User",
        founderOwnership: "40%",
        founderDilution: "10%",
        postMoney: "$10M",
        totalRaised: "$1M"
    };

    try {
        const info = await sendPDFReport(to_email, pdfBase64, summaryData);
        console.log("Test successful!", info);
    } catch (err) {
        console.error("Test failed!", err);
    }
}

test();
