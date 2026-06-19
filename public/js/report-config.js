// =============================================================================
// report-config.js  —  DATA ONLY
// -----------------------------------------------------------------------------
// This file declares the default `reportData` object that the report pages
// (summary.html, ownership.html, terms2.html) bind to. At PDF-generation time
// the server (server.js) mutates this object in place with the real values
// posted from the calculator, then calls syncReport().
//
// ALL rendering logic lives in report-logic.js (loaded immediately after this
// file). Do NOT add render functions here — a second copy of syncReport()/
// renderCharts()/setText() previously lived in this file and overrode the
// correct logic, causing the per-row "PPS" column to show the round price for
// every row instead of each row's actual conversion price.
// =============================================================================

const reportData = {
  "valuation": 10000000,
  "raised": 2500000,
  "safeAmount": 500000,
  "timestamp": new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
  }),
  "optionPool": "0%",
  "roundName": "Series A",
  "summary": {
    "ownershipPre": "40.00%",
    "ownershipPost": "33.33%",
    "dilution": "6.67%",
    "postMoney": "$12,000,000",
    "pricePerShare": "$0.50",
    "totalShares": "23,999,995",
    "totalRaised": "$2,500,000"
  },
  "rows": [
    {
      "name": "Founder 1",
      "preShares": 4000000,
      "postShares": 4000000,
      "badge": null,
      "isFounder": true,
      "isSafe": false,
      "isInvestor": false
    },
    {
      "name": "Founder 2",
      "preShares": 4000000,
      "postShares": 4000000,
      "badge": null,
      "isFounder": true,
      "isSafe": false,
      "isInvestor": false
    },
    {
      "name": "SAFE 1",
      "preShares": 10000000,
      "postShares": 9999996,
      "badge": "Post-money SAFE",
      "badgeStyle": "border-[#a7f3d0] bg-[#d1fae5] text-[#065f46]",
      "isFounder": false,
      "isSafe": true,
      "isInvestor": false,
      "investment": 500000,
      "cap": 1000000,
      "discount": "20%",
      "type": "Post-money"
    },
    {
      "name": "Investor 1",
      "preShares": 0,
      "postShares": 3999999,
      "badge": null,
      "badgeStyle": "",
      "isFounder": false,
      "isSafe": false,
      "isInvestor": true,
      "investment": 2000000
    },
    {
      "name": "Option pool",
      "preShares": 2000000,
      "postShares": 2000000,
      "badge": null,
      "badgeStyle": "",
      "isFounder": false,
      "isSafe": false,
      "isInvestor": false
    }
  ]
};

// Expose on window as well, so any code that reads window.reportData works.
if (typeof window !== "undefined") {
  window.reportData = reportData;
}
