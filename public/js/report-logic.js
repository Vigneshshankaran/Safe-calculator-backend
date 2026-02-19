function syncReport() {
  console.log("Syncing report data...");
  if (typeof reportData === 'undefined') {
      console.error("reportData is not defined. Make sure report-config.js is loaded first.");
      return;
  }

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

  setText("outcome-ownership", reportData.summary.ownershipPost);
  setText("outcome-dilution", reportData.summary.dilution);
  setText("outcome-postmoney", reportData.summary.postMoney);
  setText("outcome-pps", reportData.summary.pricePerShare);
  setText("outcome-totalshares", reportData.summary.totalShares);

  setText("bar-pre-pct", reportData.summary.ownershipPre);
  setText("bar-post-pct", reportData.summary.ownershipPost);

  const round = reportData.roundName || "Series A";
  setText("bar-pre-label", `After SAFE conversion & Before ${round}`);
  setText("bar-post-label", `After SAFE conversion & ${round}`);

  const preLabel = document.getElementById("bar-pre-pct");
  const postLabel = document.getElementById("bar-post-pct");
  
  if (reportData.summary.ownershipPre && reportData.summary.ownershipPost) {
    const hPre = parseFloat(reportData.summary.ownershipPre.replace('%', ''));
    const hPost = parseFloat(reportData.summary.ownershipPost.replace('%', ''));

    // 0% floor is at 805px, 100% ceiling is at 65px (total 740px height)
    if (preLabel) preLabel.style.top = (805 - (hPre * 7.4)) + "px";
    if (postLabel) postLabel.style.top = (805 - (hPost * 7.4)) + "px";
  }

  const tableBody = document.getElementById("table-body");
  if (tableBody) {
    let totalPre = 0;
    let totalPost = 0;
    reportData.rows.forEach(r => { 
        totalPre += (r.preShares || 0); 
        totalPost += (r.postShares || 0); 
    });

    tableBody.innerHTML = reportData.rows.map(row => {
      const prePct = totalPre > 0 ? (((row.preShares || 0) / totalPre) * 100).toFixed(2) : "0.00";
      const postPct = totalPost > 0 ? (((row.postShares || 0) / totalPost) * 100).toFixed(2) : "0.00";
      
      return `
      <div class="grid grid-cols-[1fr_250px_250px_150px_150px_150px] h-[50px] items-center px-[30px] border-b border-[#D2D2D2]">
        <div class="flex items-center">
          <span class="text-[25px] font-semibold text-[#0d0d0d] tracking-[-0.75px] truncate">${row.name}</span>
          ${(row.badge && !row.isInvestor) ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-[7px] border ${row.badgeStyle || ""} text-[15px] font-semibold tracking-[-0.45px] leading-[0.9] ml-2 whitespace-nowrap">${row.badge}</span>` : ""}
        </div>
        <span class="text-[25px] font-semibold text-[#6c6c6c] tracking-[-0.75px] text-right">${(row.preShares || 0).toLocaleString()}</span>
        <span class="text-[25px] font-semibold text-[#0d0d0d] tracking-[-0.75px] text-right">${(row.postShares || 0).toLocaleString()}</span>
        <span class="text-[25px] font-semibold text-[#6c6c6c] tracking-[-0.75px] text-right">${prePct}%</span>
        <span class="text-[25px] font-semibold text-[#0d0d0d] tracking-[-0.75px] text-right">${postPct}%</span>
        <span class="text-[25px] font-semibold text-[#6c6c6c] tracking-[-0.75px] text-right">${(row.preShares || 0) > 0 ? (reportData.summary.pricePerShare || "—") : "—"}</span>
      </div>
    `;}).join("");
    
    setText("total-pre", totalPre.toLocaleString());
    setText("total-post", totalPost.toLocaleString());
  }

  const interpEl = document.getElementById("interpretation-content");
  if (interpEl) {
    const founderPost = reportData.rows.filter(r => r.isFounder).reduce((s, r) => s + (r.postShares || 0), 0);
    const totalPost = reportData.rows.reduce((s, r) => s + (r.postShares || 0), 0);
    const founderPct = totalPost > 0 ? ((founderPost / totalPost) * 100).toFixed(2) : "0.00";

    interpEl.innerHTML = `
      <p>You are modeling a ${reportData.roundName || "Series A"} round raising ${reportData.summary.totalRaised || "$0"} at a ${reportData.summary.postMoney || "$0"} post-money valuation. Founder ownership changes from ${reportData.summary.ownershipPre || "0%"} to ${founderPct}% post-round.</p>
      <p class="mt-4">${reportData.rows.filter(r => r.isSafe).length} SAFE(s) totaling $${(reportData.safeAmount || 0).toLocaleString()} will convert.</p>
      <div class="mt-4">
        <p>${parseFloat(founderPct) < 50 ? "Founders have dropped below 50% majority ownership." : "Founders maintain majority ownership."}</p>
        <p>The model includes an option pool top-up to reach the target of ${reportData.optionPool || "0%"}.</p>
      </div>
    `;
  }

  setText("term-valuation", reportData.summary.postMoney);
  setText("term-raising", reportData.summary.totalRaised);
  setText("term-optionpool", reportData.optionPool);
  setText("term-roundname", reportData.roundName);

  const safeBody = document.getElementById("safe-breakdown-body");
  if (safeBody) {
    const safes = reportData.rows.filter(r => r.isSafe);
    safeBody.innerHTML = safes.map((s, i) => {
        const rowTop = 261 + (i * 45);
        const lineTop = rowTop + 28;
        let html = `<div class="absolute contents font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[0.9] text-[#0d0d0d] text-[15px] tracking-[-0.45px]">`;
        html += `<div class="absolute left-[30px] top-[${rowTop}px] flex items-center">`;
        html += `<span>${s.name}</span>`;
        if (s.badge) {
            html += `<span class="inline-flex items-center px-1.5 py-0.5 rounded-[7px] border ${s.badgeStyle || ""} text-[10px] font-semibold tracking-[-0.3px] leading-[0.9] ml-2 whitespace-nowrap">${s.badge}</span>`;
        }
        html += `</div>`;
        html += `<p class="-translate-x-full absolute left-[410px] text-right top-[${rowTop}px]">${(s.investment || 0).toLocaleString()}</p>`;
        html += `<p class="-translate-x-full absolute left-[619px] text-right top-[${rowTop}px]">${(s.cap || 0).toLocaleString()}</p>`;
        html += `<p class="-translate-x-full absolute left-[788px] text-right top-[${rowTop}px]">${s.discount || "None"}</p>`;
        html += `<p class="-translate-x-full absolute left-[918px] text-right top-[${rowTop}px]">${s.type || "Post-money"}</p>`;
        html += `<div class="absolute h-0 left-[26px] top-[${lineTop}px] w-[912px]"><div class="absolute inset-[-0.25px_0]"><svg class="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 912 0.5"><path d="M0 0.25H912" stroke="#D2D2D2" stroke-width="0.5"></path></svg></div></div>`;
        html += `</div>`;
        return html;
    }).join("");

    const totalSafeInv = safes.reduce((sum, s) => sum + (s.investment || 0), 0);
    setText("safe-total-investment", "$" + totalSafeInv.toLocaleString());
  }

  const investorBody = document.getElementById("round-investors-body");
  if (investorBody) {
    const investors = reportData.rows.filter(r => r.isInvestor);
    investorBody.innerHTML = investors.map((inv, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const left = col === 0 ? 970 : 1445;
        const top = 195 + (row * 60);
        let html = `<div class="absolute left-[${left}px] top-[${top}px] w-[465px] h-[55px] bg-[#eeebfb] border border-[#4039a8] border-solid flex items-center px-[10px] justify-between">`;
        html += `<div class="flex items-center">`;
        html += `<p class="font-semibold text-[#4039a8] text-[15px]">${inv.name}</p>`;
        html += `</div>`;
        html += `<p class="font-semibold text-[#4039a8] text-[15px]">$${(inv.investment || 0).toLocaleString()}</p>`;
        html += `</div>`;
        return html;
    }).join("");
  }

  renderCharts();
}

function renderCharts() {
    console.log("renderCharts called...");
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js not loading - CDN might be slow or blocked");
        setTimeout(renderCharts, 100);
        return;
    }
    console.log("Chart.js is ready!");

    const rows = reportData.rows;
    const totalPost = rows.reduce((s, r) => s + (r.postShares || 0), 0);
    
    const pieCanvas = document.getElementById('pieChartCanvas');
    if (pieCanvas) {
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
                layout: { padding: 0 },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });

        const legendContainer = document.getElementById('doughnut-legend');
        if (legendContainer) {
            legendContainer.innerHTML = rows.map((r, i) => {
                const pct = totalPost > 0 ? ((r.postShares / totalPost) * 100).toFixed(1) : "0.0";
                if (parseFloat(pct) < 0.1) return ""; 
                return `
                    <div class="flex items-center gap-2">
                        <div class="size-[12px] rounded-sm shrink-0" style="background-color: ${backgroundColors[i]}"></div>
                        <span class="text-[13px] font-bold text-[#494949] truncate">${r.name} (${pct}%)</span>
                    </div>
                `;
            }).join("");
        }
    }

    const barCanvas = document.getElementById('barChartCanvas');
    if (barCanvas) {
        const existingChart = Chart.getChart(barCanvas);
        if (existingChart) existingChart.destroy();

        if (reportData.summary.ownershipPre && reportData.summary.ownershipPost) {
            const prePct = parseFloat(reportData.summary.ownershipPre.replace('%', ''));
            const postPct = parseFloat(reportData.summary.ownershipPost.replace('%', ''));

            new Chart(barCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Pre-round', 'Post-round'],
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
                    layout: { padding: 0 },
                    scales: {
                        y: {
                            display: false,
                            beginAtZero: true,
                            min: 0,
                            max: 100,
                            ticks: { padding: 0 }
                        },
                        x: { display: false }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
            console.log("Bar chart rendered with precision alignment.");
        }
    }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value || "";
}

document.addEventListener("DOMContentLoaded", syncReport);
if (document.readyState === "complete" || document.readyState === "interactive") {
    syncReport();
}
