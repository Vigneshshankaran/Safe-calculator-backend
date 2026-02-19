const https = require('http'); // The server is http locally

const data = JSON.stringify({
    to_email: "vignesh@equitylist.co",
    summaryData: {
        firstName: "Server",
        lastName: "Test",
        founderOwnership: "40%",
        founderDilution: "10%",
        postMoney: "$10M",
        totalRaised: "$1M"
    },
    reportData: {
        roundName: "Series A",
        timestamp: "Now",
        summary: {
            ownershipPre: "40%",
            ownershipPost: "33%",
            dilution: "7%",
            postMoney: "$12M",
            pricePerShare: "$0.50",
            totalShares: "24M",
            totalRaised: "$2.5M"
        },
        rows: [
            { name: "Founder", preShares: 1000, postShares: 1000, isFounder: true }
        ]
    }
});

const options = {
    hostname: 'localhost',
    port: 3005,
    path: '/send-email',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
