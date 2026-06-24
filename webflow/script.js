
/* 
================================================================
PART 1: CORE ENGINE
Constants, Formatting, and calculation logic.
================================================================
*/
const CapTableRowType = {
    Common: "common",
    Safe: "safe",
    Series: "series",
    Total: "total",
    RefreshedOptions: "refreshedOptions",
};

const DEFAULT_ROUNDING_STRATEGY = {
    roundShares: true,
    roundPPSPlaces: 8,
};

const stringToNumber = (value) => {
    
    if (typeof value === "number") return value;

    const cleanedValue = String(value).replace(/[^-\d.]/g, "");

    return cleanedValue.includes(".")
        ? parseFloat(cleanedValue)
        : parseInt(cleanedValue, 10) || 0;
};

const formatUSDWithCommas = (value) => {
    const num = stringToNumber(value);
    return num.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0, 
    });
};

const formatNumberWithCommas = (value) => {
    return stringToNumber(value).toLocaleString("en-US", { style: "decimal" });
};

const safeFormatPercent = (value, decimals = 2) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    const formatted = (value * 100).toFixed(decimals);
    if (parseFloat(formatted) === 0) return "—";
    return `${formatted}%`;
};

const safeFormatNumber = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    return formatNumberWithCommas(value);
};

const safeFormatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    return formatUSDWithCommas(value);
};

const formatPPSWithCommas = (value) => {
    const num = stringToNumber(value);
    return num.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 3,  
        minimumFractionDigits: 2,  
    });
};

const safeFormatPPS = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    return formatPPSWithCommas(value);
};

const formatInputLive = (input) => {
    let value = input.value;
    const start = input.selectionStart;
    const oldLength = value.length;

    let digits = value.replace(/\D/g, "");
    input.value = digits === "" ? "0" : formatNumberWithCommas(parseInt(digits));

    const newLength = input.value.length;
    const diff = newLength - oldLength;
    const newPos = Math.max(0, start + diff);
    input.setSelectionRange(newPos, newPos);
};

window.formatInputLive = formatInputLive;

const formatDiscountLive = (input) => {
    let value = input.value;
    // Remove non-digits
    let digits = value.replace(/\D/g, "");
    
    // Limit to 2 digits total
    if (digits.length > 2) {
        digits = digits.slice(0, 2);
    }
    
    // Check for max value 99
    let num = parseInt(digits) || 0;
    if (num > 99) {
        num = 99;
        digits = "99";
    }
    
    // Update input (allow empty if user cleared it)
    input.value = digits === "" ? "" : num.toString();
};

window.formatDiscountLive = formatDiscountLive;

const roundShares = (num, strategy = DEFAULT_ROUNDING_STRATEGY) => {
    if (strategy.roundDownShares) return Math.floor(num);
    if (strategy.roundShares) return Math.round(num);
    return num;
};

const roundPPSToPlaces = (num, places) => {
    if (places < 0) return num;
    const factor = Math.pow(10, places);
    return Math.ceil(num * factor) / factor;
};

/**
 * Checks if a SAFE note is a "Most Favored Nation" (MFN) note.
 * MFN SAFEs don't have their own cap but adopt the best cap (lowest) 
 * from other SAFEs in the same round.
 */
const isMFN = (safe) => {
    return (
        safe.conversionType === "mfn" ||
        safe.conversionType === "ycmfn" ||
        (safe.sideLetters && safe.sideLetters.includes("mfn"))
    );
};

const getMFNCapAfter = (rows, idx) => {
    return (
        rows.slice(idx + 1).reduce((val, row) => {
            if (isMFN(row) || row.conversionType === "pre") return val;
            if (val === 0) return row.cap;
            if (val > 0 && row.cap > 0 && row.cap < val) return row.cap;
            return val;
        }, 0) || 0
    );
};

const getCapForSafe = (idx, safes, preMoneyValuation = 0) => {
    const safe = safes[idx];
    if (!isMFN(safe)) return safe.cap;
    const inheritedCap = getMFNCapAfter(safes, idx);
    const ownCap = safe.cap || 0;
    
    let baseCap = 0;
    if (ownCap > 0 && inheritedCap > 0) baseCap = Math.min(ownCap, inheritedCap);
    else if (ownCap > 0) baseCap = ownCap;
    else if (inheritedCap > 0) baseCap = inheritedCap;
    else baseCap = preMoneyValuation;

    if (baseCap > 0 && isMFN(safe) && safe.discount > 0 && inheritedCap === 0 && ownCap === 0) {
        return baseCap * (1 - safe.discount);
    }
    
    return baseCap;
};

/**
 * Resolves Valuation Caps for all SAFEs, including MFNs.
 * Iterates through notes to ensure MFN notes adopt the lowest cap found in the list.
 */
const populateSafeCaps = (safeNotes, preMoneyValuation = 0) => {
    return safeNotes.map((safe, idx) => {
        if (isMFN(safe)) {
            return { ...safe, cap: getCapForSafe(idx, safeNotes, preMoneyValuation) };
        }
        return { ...safe };
    });
};

const safeConvert = (safe, preShares, postShares, pps) => {
    if (safe.cap === 0) return (1 - (safe.discount || 0)) * pps;
    const discountPPS = (1 - (safe.discount || 0)) * pps;
    const shares = safe.conversionType === "pre" ? preShares : postShares;
    const capPPS = safe.cap / shares;
    return Math.min(discountPPS, capPPS);
};

const sumSafeConvertedShares = (safes, pps, preMoneyShares, postMoneyShares, roundingStrategy) => {
    return safes.reduce((acc, safe) => {
        const discountPPS = roundPPSToPlaces(
            safeConvert(safe, preMoneyShares, postMoneyShares, pps),
            roundingStrategy.roundPPSPlaces
        );
        const postSafeShares = safe.investment / discountPPS;
        return acc + roundShares(postSafeShares, roundingStrategy);
    }, 0);
};

const checkSafeNotesForErrors = (safeNotes) => {
    const errors = {};
    safeNotes.forEach((safe) => {
        if (safe.investment >= safe.cap && safe.cap !== 0) {
            errors[safe.id] = "SAFE investment cannot be greater than or equal to the valuation cap.";
        }
        if (safe.discount >= 1) {
            errors[safe.id] = `SAFE "${safe.name}" has a discount of 100% or more. This results in a zero share price, which is mathematically invalid for the calculation.`;
        }
    });
    return errors;
};

/**
 * Core algebraic solver for the Price Per Share (PPS).
 * Uses the formula: PPS = (Pre-Money + New Investment) / (Total Post-Money Shares)
 * This function accounts for dilution from SAFEs and Option pool top-ups.
 */
const calculatePreAndPostMoneyShares = (
    preMoneyValuation,
    commonShares,
    unusedOptions,
    targetOptionsPct,
    seriesInvestments,
    totalShares,
    roundingStrategy = DEFAULT_ROUNDING_STRATEGY
) => {
    let optionsPool = roundShares(totalShares * (targetOptionsPct / 100), roundingStrategy);
    if (optionsPool < unusedOptions) optionsPool = unusedOptions;
    const increaseInOptionsPool = optionsPool - unusedOptions;
    const seriesInvestmentTotal = seriesInvestments.reduce((a, b) => a + b, 0);
    const pps = totalShares > 0
        ? roundPPSToPlaces((preMoneyValuation + seriesInvestmentTotal) / totalShares, roundingStrategy.roundPPSPlaces)
        : 0;
    const seriesShares = pps > 0
        ? seriesInvestments.reduce((acc, inv) => acc + roundShares(inv / pps, roundingStrategy), 0)
        : 0;
    const preMoneyShares = commonShares + unusedOptions + increaseInOptionsPool;
    const postMoneyShares = totalShares - seriesShares - increaseInOptionsPool;

    return {
        preMoneyShares,
        postMoneyShares,
        pps,
        optionsPool,
        increaseInOptionsPool,
        totalShares: postMoneyShares + increaseInOptionsPool + seriesShares,
        seriesShares,
        totalSeriesInvestment: seriesInvestmentTotal,
    };
};

const attemptFit = (preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, safes, seriesInvestments, totalShares, roundingStrategy = DEFAULT_ROUNDING_STRATEGY) => {
    const results = calculatePreAndPostMoneyShares(preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, seriesInvestments, totalShares, roundingStrategy);
    const safeShares = sumSafeConvertedShares(safes, results.pps, results.preMoneyShares, results.postMoneyShares, roundingStrategy);
    return results.seriesShares + commonShares + results.optionsPool + safeShares;
};

/**
 * Iterative "FIT" solver to handle circular dependencies.
 * In many startup rounds, the Option pool size depends on the Post-Money Valuation,
 * which in turn depends on the Price Per Share, which depends on the Option pool size.
 * This function runs multiple iterations to converge on the mathematically correct PPS.
 */
const fitConversion = (
    preMoneyValuation,
    commonShares,
    safes,
    unusedOptions,
    targetOptionsPct,
    seriesInvestments,
    roundingStrategy = DEFAULT_ROUNDING_STRATEGY
) => {
    let totalShares = commonShares + unusedOptions;
    let lastTotalShares = totalShares;
    for (let i = 0; i < 100; i++) {
        totalShares = attemptFit(preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, safes, seriesInvestments, totalShares, roundingStrategy);
        if (totalShares === lastTotalShares) break;
        lastTotalShares = totalShares;
    }
    const res = calculatePreAndPostMoneyShares(preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, seriesInvestments, totalShares, roundingStrategy);
    const ppss = safes.map((safe) =>
        roundPPSToPlaces(safeConvert(safe, res.preMoneyShares, res.postMoneyShares, res.pps), roundingStrategy.roundPPSPlaces)
    );
    const convertedSafeShares = sumSafeConvertedShares(safes, res.pps, res.preMoneyShares, res.postMoneyShares, roundingStrategy);
    const totalSeriesInvestment = seriesInvestments.reduce((a, b) => a + b, 0);

    return {
        ...res,
        ppss,
        totalShares,
        newSharesIssued: totalShares - commonShares - unusedOptions,
        convertedSafeShares,
        totalOptions: res.increaseInOptionsPool + unusedOptions,
        additionalOptions: res.increaseInOptionsPool,
        totalInvested: totalSeriesInvestment + safes.reduce((acc, safe) => acc + safe.investment, 0),
        totalSeriesInvestment,
    };
};

const buildTBDPreRoundCapTable = (safeNotes, common) => {
    const totalInvestment = safeNotes.reduce((acc, investor) => acc + investor.investment, 0);
    const totalShares = common.reduce((acc, c) => acc + c.shares, 0);
    const reason = "Unable to model Pre-Round cap table with uncapped SAFE's";
    return {
        common: common.map((c) => ({
            ...c,
            ownershipPct: 0,
            ownershipError: { type: "tbd", reason },
        })),
        safes: safeNotes.map((s) => ({
            ...s,
            ownershipError: { type: "tbd", reason },
            type: CapTableRowType.Safe,
        })),
        total: {
            name: "Total",
            shares: totalShares,
            investment: totalInvestment,
            ownershipPct: 1,
            type: CapTableRowType.Total,
        },
    };
};

const buildErrorPreRoundCapTable = (safeNotes, common) => {
    const totalInvestment = safeNotes.reduce((acc, investor) => acc + investor.investment, 0);
    const totalShares = common.reduce((acc, c) => acc + c.shares, 0);
    return {
        common: common.map((c) => ({
            ...c,
            ownershipPct: 0,
            ownershipError: { type: "error" },
        })),
        safes: safeNotes.map((s) => {
            const error = { type: "error" };
            if (s.investment >= s.cap && s.cap !== 0) error.reason = "SAFE investment cannot equal or exceed the valuation cap";
            return { ...s, ownershipError: error, type: CapTableRowType.Safe };
        }),
        total: {
            name: "Total",
            shares: totalShares,
            investment: totalInvestment,
            ownershipPct: 1,
            type: CapTableRowType.Total,
        },
    };
};

const buildStrictlyPreRoundCapTable = (rowData) => {
    const common = rowData.filter((r) => r.type === CapTableRowType.Common);
    const totalShares = common.reduce((acc, r) => acc + r.shares, 0);

    return {
        common: common.map((c) => ({
            ...c,
            ownershipPct: totalShares > 0 ? c.shares / totalShares : 0,
        })),
        safes: rowData
            .filter((r) => r.type === CapTableRowType.Safe)
            .map((s) => ({ ...s, shares: 0, ownershipPct: 0 })),
        total: {
            shares: totalShares,
            investment: 0,
            ownershipPct: 1,
            type: CapTableRowType.Total,
        },
    };
};

const buildEstimatedPreRoundCapTable = (
    rowData,
    roundingStrategy = DEFAULT_ROUNDING_STRATEGY
) => {

    const common = rowData.filter((r) => r.type === CapTableRowType.Common);
    const preMoneyShares = common.reduce((acc, r) => acc + r.shares, 0);
    const safeNotes = populateSafeCaps(
        rowData.filter((r) => r.type === CapTableRowType.Safe)
    );

    if (safeNotes.length === 0) {
        return buildStrictlyPreRoundCapTable(rowData);
    }

    if (safeNotes.some((s) => s.cap !== 0 && s.cap <= s.investment)) {

        return buildErrorPreRoundCapTable(safeNotes, common);

    }

    const maxCap = safeNotes.reduce((max, s) => Math.max(max, s.cap), 0);

    if (maxCap === 0) return buildTBDPreRoundCapTable(safeNotes, common);

    let safeRows = safeNotes.map((safe) => {

        const cap = safe.cap === 0 ? maxCap : safe.cap;

        if (safe.conversionType === "pre") {

            const shares = roundShares(

                (safe.investment / cap) * preMoneyShares,

                roundingStrategy

            );

            return { ...safe, shares, type: CapTableRowType.Safe };

        } else {

            return {

                ...safe,

                ownershipPct: safe.investment / cap,

                type: CapTableRowType.Safe,

            };

        }

    });

    const preMoneySafeShares = safeRows.reduce(

        (acc, s) => acc + (s.shares || 0),

        0

    );

    const postSharePct = safeRows.reduce(

        (acc, s) => acc + (s.ownershipPct || 0),

        0

    );

    const postCap = roundShares(

        (preMoneyShares + preMoneySafeShares) / (1 - postSharePct),

        roundingStrategy

    );

    safeRows = safeRows.map((s) => {

        if (s.shares) return { ...s, ownershipPct: s.shares / postCap };

        return {

            ...s,

            shares: roundShares((s.ownershipPct || 0) * postCap, roundingStrategy),

        };

    });

    const finalTotalShares =

        preMoneyShares + safeRows.reduce((acc, s) => acc + (s.shares || 0), 0);

    return {

        common: common.map((c) => ({ ...c, ownershipPct: c.shares / postCap })),

        safes: safeRows,

        total: {

            shares: finalTotalShares,

            investment: safeNotes.reduce((a, s) => a + s.investment, 0),

            ownershipPct: 1,

            type: CapTableRowType.Total,

        },

    };

};

/**
 * Maps the solved priced round data back into a readable Cap Table format.
 * Calculates final share counts for Founders, SAFEs, and New Investors.
 */
const buildPricedRoundCapTable = (pricedConversion, rowData) => {

    const common = rowData.filter(

        (r) => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool"

    );

    const safes = rowData.filter((r) => r.type === CapTableRowType.Safe);

    const series = rowData.filter((r) => r.type === CapTableRowType.Series);

    const totalShares = pricedConversion.totalShares;

    const totalInvestment =

        series.reduce((a, s) => a + s.investment, 0) +

        safes.reduce((a, s) => a + s.investment, 0);

    return {

        common: common.map((c) => ({ ...c, ownershipPct: c.shares / totalShares })),

        safes: safes.map((s, idx) => {

            const pps = pricedConversion.ppss[idx];

            const shares = roundShares(s.investment / pps);

            return {

                ...s,

                pps,

                shares,

                ownershipPct: shares / totalShares,

                type: CapTableRowType.Safe,
                isMFN: isMFN(s),

            };

        }),

        series: series.map((se) => {

            const shares = roundShares(se.investment / pricedConversion.pps);

            return {

                ...se,

                pps: pricedConversion.pps,

                shares,

                ownershipPct: shares / totalShares,

                type: CapTableRowType.Series,

            };

        }),

        refreshedOptionsPool: {

            name: "Refreshed Options Pool",

            shares: pricedConversion.totalOptions,

            ownershipPct: pricedConversion.totalOptions / totalShares,

            type: CapTableRowType.RefreshedOptions,

        },

        total: {

            name: "Total",

            shares: totalShares,

            investment: totalInvestment,

            ownershipPct: 1,

            type: CapTableRowType.Total,

        },

    };

};

/* 
================================================================
PART 2: UI & RENDERING
State management, updateUI, and chart rendering.
================================================================
*/
const INITIAL_STATE = {
    name: "Standalone Worksheet",
    roundName: "Series A",
    rowData: [
        {
            id: "1",
            type: "common",
            name: "Founder 1",
            shares: 4000000,
            category: "Founder",
        },
        {
            id: "2",
            type: "common",
            name: "Founder 2",
            shares: 4000000,
            category: "Founder",
        },
        {
            id: "UnusedOptionsPool",
            type: "common",
            name: "Option pool",
            shares: 2000000,
            category: "Option pool",
        },
        {
            id: "3",
            type: "safe",
            name: "SAFE 1",
            investment: 500000,
            cap: 1000000,
            discount: 0.2, 
            conversionType: "post",
        },
        { id: "4", type: "series", name: "Investor 1", investment: 2000000 },
    ],
    preMoney: 10000000,
    targetOptionsPool: null,
    pricedRounds: 1, 
};

let state = JSON.parse(JSON.stringify(INITIAL_STATE));

let resultsStale = false;

const setResultsStale = (stale) => {
    resultsStale = stale;
    const rc = document.querySelector(".results-column-sticky");
    const bd = document.getElementById("breakdown-section");
    if (rc) rc.classList.toggle("is-stale", stale);
    if (bd) bd.classList.toggle("is-stale", stale);
};

window.calculateResults = () => updateUI({ compute: true });

window.goToStep = function(step) {
  const sections = {
    1: 'cap-table-section',
    2: 'safes-section',
    3: 'priced-round-section'
  };
  Object.entries(sections).forEach(([s, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = parseInt(s) === step ? '' : 'none';
  });
  [1, 2, 3].forEach(s => {
    const el = document.getElementById(`step-${s}`);
    if (!el) return;
    el.classList.remove('active', 'completed');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('completed');
  });
};

window.resetCalculator = () => {
    state = JSON.parse(JSON.stringify(INITIAL_STATE));
    clearGlobalErrors();
    updateUI();
};

const showGlobalError = (message) => {
    const container = document.getElementById("global-error-container");
    if (container) {
        container.innerHTML = ""; // Clear any previous inline errors
    }
    
    // Show only the toast (popup) as requested
    showToast(message, 'error');
};

const clearGlobalErrors = () => {
    const container = document.getElementById("global-error-container");
    if (container) container.innerHTML = "";
};

const TRASH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`;

// Renders the live, always-on parts of the UI: validation, editable rows,
// and current cap-table figures. Safe to run on every keystroke.
const renderInputs = () => {
    clearGlobalErrors();

    const preMoneyErrorEl = document.getElementById("pre-money-error");
    const preMoneyInputWrapper = document.querySelector(".valuation-input-wrapper");

    if (preMoneyErrorEl) {
        preMoneyErrorEl.textContent = "";
        preMoneyErrorEl.style.display = "none";
    }
    if (preMoneyInputWrapper) preMoneyInputWrapper.classList.remove("input-invalid-border");

    // Contextual Pre-money Validation: only show error if investment exists WITHOUT a cap or discount
    const hasInvestmentWithoutTerms = state.rowData.some(r => {
        if (r.type === CapTableRowType.Safe) {
            return r.investment > 0 && (r.cap === 0 || !r.cap) && (r.discount === 0 || !r.discount);
        }
        return false;
    });

    if (state.preMoney <= 0 && hasInvestmentWithoutTerms) {
        if (preMoneyErrorEl) {
            preMoneyErrorEl.textContent = "Pre-money valuation is required and must be greater than 0.";
            preMoneyErrorEl.style.display = "block";
        }
        if (preMoneyInputWrapper) preMoneyInputWrapper.classList.add("input-invalid-border");
    }

    const preMoneyInput = document.getElementById("pre-money-input");
    if (preMoneyInput && document.activeElement !== preMoneyInput) {
        preMoneyInput.value = formatNumberWithCommas(state.preMoney);
    }

    const targetOptionsInput = document.getElementById("target-options-input");
    if (targetOptionsInput && document.activeElement !== targetOptionsInput) {
        targetOptionsInput.value = state.targetOptionsPool === null ? "" : state.targetOptionsPool;
    }

    const rawSafes = state.rowData.filter((r) => r.type === CapTableRowType.Safe);
    const safes = populateSafeCaps(rawSafes, state.preMoney);
    const safeErrors = checkSafeNotesForErrors(safes);

    renderSAFEs(safeErrors);
    renderSeriesInvestors();

    const esopRow = state.rowData.find((r) => r.id === "UnusedOptionsPool");
    const unusedOptionsValue = esopRow ? esopRow.shares : 0;

    // Current Cap Table Snapshot (for input management)
    const currentTotalShares = state.rowData
        .filter((r) => r.type === CapTableRowType.Common)
        .reduce((a, r) => a + r.shares, 0);

    const totalSharesVal = document.getElementById("total-shares-val");
    if (totalSharesVal) totalSharesVal.textContent = formatNumberWithCommas(currentTotalShares);

    const currentEsopVal = document.getElementById("current-esop-val");
    if (currentEsopVal) currentEsopVal.textContent = formatNumberWithCommas(unusedOptionsValue);

    renderShareholders(currentTotalShares);
};

// Runs the priced-round computation and renders all derived results
// (results card, breakdown table, pie chart, AI insights). Gated behind Calculate.
const computeResults = () => {
    const clearResults = () => {
        document.getElementById("round-pps-val").textContent = "—";
        document.getElementById("post-money-val").textContent = "—";
        document.getElementById("total-post-shares-val").textContent = "—";
        document.getElementById("founder-ownership-val").textContent = "—";
        document.getElementById("founder-dilution-val").textContent = "—";
        const prt = document.getElementById("post-round-table"); if (prt) prt.innerHTML = "";
        const pcc = document.getElementById("pie-chart-container"); if (pcc) pcc.innerHTML = "";
        const aic = document.getElementById("ai-insights-container"); if (aic) aic.innerHTML = "";
    };

    if (state.preMoney <= 0) { clearResults(); return; }

    const rawSafes = state.rowData.filter((r) => r.type === CapTableRowType.Safe);
    const safes = populateSafeCaps(rawSafes, state.preMoney);
    const safeErrors = checkSafeNotesForErrors(safes);
    if (Object.keys(safeErrors).length > 0) { clearResults(); return; }

    // =========================================================================
    // SNAPSHOT 2: PRE-ROUND CAP TABLE (Post-SAFE)
    // =========================================================================
    const preRound = buildEstimatedPreRoundCapTable(state.rowData);

    const esopRow = state.rowData.find((r) => r.id === "UnusedOptionsPool");
    const unusedOptionsValue = esopRow ? esopRow.shares : 0;

    {
        const roundNames = document.querySelectorAll(".display-round-name");
        roundNames.forEach(el => {
            el.textContent = state.roundName || "priced round";
        });

        const commonShares = state.rowData
            .filter((r) => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool")
            .reduce((a, r) => a + r.shares, 0);

        const seriesInvs = state.rowData
            .filter((r) => r.type === CapTableRowType.Series)
            .map((s) => s.investment);

        const pricedConversion = fitConversion(
            state.preMoney,
            commonShares,
            safes,
            unusedOptionsValue,
            state.targetOptionsPool,
            seriesInvs
        );

        const roundPpsEl = document.getElementById("round-pps-val");
        if (roundPpsEl) roundPpsEl.textContent = safeFormatPPS(pricedConversion.pps);

        const postMoneyVal = pricedConversion.totalShares * pricedConversion.pps;
        const postMoneyEl = document.getElementById("post-money-val");
        if (postMoneyEl) postMoneyEl.textContent = safeFormatCurrency(postMoneyVal);
        
        const additionalOptions = pricedConversion.additionalOptions;
        const additionalOptionsEl = document.getElementById("additional-options-val");
        if (additionalOptionsEl) additionalOptionsEl.textContent = safeFormatNumber(additionalOptions);

        const additionalOptionsTextEl = document.getElementById("additional-options-val-text");
        const meetsTargetNoteEl = document.getElementById("option-pool-meets-target-note");
        
        if (additionalOptionsTextEl) {
            // Keep this always visible as requested
            additionalOptionsTextEl.style.display = "block";
            additionalOptionsTextEl.textContent = `+${safeFormatNumber(additionalOptions)} shares will be added to reach the target`;
        }
        
        if (meetsTargetNoteEl) {
            // Show the "already meets" note separately below
            meetsTargetNoteEl.style.display = (additionalOptions <= 0 && state.targetOptionsPool > 0) ? "block" : "none";
        }
        const newInvestorsSharesEl = document.getElementById("new-investors-shares-val");
        if (newInvestorsSharesEl) newInvestorsSharesEl.textContent = safeFormatNumber(pricedConversion.seriesShares);

        // =========================================================================
        // SNAPSHOT 3: POST-ROUND CAP TABLE
        // =========================================================================
        const postRound = buildPricedRoundCapTable(pricedConversion, state.rowData);

        // Synchronize SAFE shares between Pre and Post if a priced round exists.
        // This ensures the "Pre" column shows the actual conversion realized in the round,
        // rather than a standalone estimate.
        preRound.safes = preRound.safes.map(preSafe => {
            const postSafe = postRound.safes.find(ps => ps.id === preSafe.id);
            return postSafe ? { ...preSafe, shares: postSafe.shares } : preSafe;
        });

        // Recalculate pre-round totals and percentages based on synchronized shares
        preRound.total.shares = preRound.common.reduce((a, c) => a + (c.shares || 0), 0) + 
                                preRound.safes.reduce((a, s) => a + (s.shares || 0), 0);
        preRound.common.forEach(c => c.ownershipPct = c.shares / preRound.total.shares);
        preRound.safes.forEach(s => s.ownershipPct = s.shares / preRound.total.shares);

        const totalPostSharesEl = document.getElementById("total-post-shares-val");
        if (totalPostSharesEl) totalPostSharesEl.textContent = safeFormatNumber(postRound.total.shares);

        const foundersPost = postRound.common.filter((c) => c.category === "Founder");
        const totalFounderPctPost = foundersPost.reduce((a, f) => a + f.ownershipPct, 0);

        // All "Pre" calculations happen 'Post-SAFE Pre-Round'
        const commonSharesTotalPre = preRound.total.shares;
        const founderSharesPre = preRound.common
            .filter((c) => c.category === "Founder")
            .reduce((a, c) => a + c.shares, 0);

        const totalFounderPctPre = commonSharesTotalPre > 0 ? founderSharesPre / commonSharesTotalPre : 0;

        const founderOwnershipEl = document.getElementById("founder-ownership-val");
        if (founderOwnershipEl) founderOwnershipEl.textContent = safeFormatPercent(totalFounderPctPost);

        const dilution = totalFounderPctPre > 0 ? totalFounderPctPre - totalFounderPctPost : NaN;
        const founderDilutionEl = document.getElementById("founder-dilution-val");
        if (founderDilutionEl) founderDilutionEl.textContent = safeFormatPercent(dilution);

        // Update founder ownership comparison bars
        const founderBeforeBar = document.getElementById("founder-before-bar");
        const founderBeforeVal = document.getElementById("founder-before-val");
        const founderAfterBar = document.getElementById("founder-after-bar");
        const founderAfterVal = document.getElementById("founder-after-val");

        if (founderBeforeBar && founderBeforeVal) {
          const beforePct = Math.max(0, Math.min(100, totalFounderPctPre * 100));
          founderBeforeBar.style.width = beforePct + "%";
          founderBeforeVal.textContent = safeFormatPercent(totalFounderPctPre);
        }
        if (founderAfterBar && founderAfterVal) {
          const afterPct = Math.max(0, Math.min(100, totalFounderPctPost * 100));
          founderAfterBar.style.width = afterPct + "%";
          founderAfterVal.textContent = safeFormatPercent(totalFounderPctPost);
        }

        const dilutionNoteEl = document.getElementById("dilution-summary-note");
        if (dilutionNoteEl) {
            const dilutionVal = isNaN(dilution) ? "—" : (dilution * 100).toFixed(2);
            dilutionNoteEl.textContent = `Founders diluted by ${dilutionVal} percentage points.`;
        }

        // Pass Pre-Round (Post-SAFE) and Post-Round to the breakdown table.
        renderBreakdownTable(preRound, postRound, pricedConversion.pps);
        renderPieChart(postRound);
        renderAIAdvisor(preRound, postRound, pricedConversion, state, totalFounderPctPre);
    }
};

// Orchestrator. Always re-renders inputs; only recomputes results when
// compute === true (Calculate / initial load / reset). Otherwise marks the
// results stale and reveals the blur + "Recalculate" overlay.
const updateUI = (opts = {}) => {
    const compute = !(opts && opts.compute === false);
    try {
        renderInputs();
        if (compute) {
            computeResults();
            setResultsStale(false);
        } else {
            setResultsStale(true);
        }
    } catch (error) {
        console.error("Error updating UI:", error);
    }
};

const renderShareholders = (totalSharesS0) => {
    const container = document.getElementById("shareholders-body");
    container.innerHTML = `
        <div class="sh-col-head">
            <div class="l">Stakeholder</div>
            <div class="l">Category</div>
            <div class="r">Shares</div>
            <div class="r">Owned</div>
            <div></div>
        </div>`;
    const shareholders = state.rowData.filter((r) => r.type === CapTableRowType.Common);
    const showDelete = shareholders.length > 1;
    const template = document.getElementById("shareholder-card-template");
    
    shareholders.forEach((row) => {
        const ownershipPct = totalSharesS0 > 0 ? row.shares / totalSharesS0 : NaN;
        const pctText = safeFormatPercent(ownershipPct);
        const clone = template.content.cloneNode(true);

        // Wire up name input
        const nameInput = clone.querySelector('.row-name');
        nameInput.value = row.name || '';
        nameInput.onchange = (e) => updateRow(row.id, 'name', e.target.value);

        const deleteBtn = clone.querySelector(".row-trash-btn");
        const commonCount = shareholders.length;
        if (commonCount > 1) {
            deleteBtn.innerHTML = TRASH_ICON;
            deleteBtn.onclick = () => deleteRow(row.id);
        } else {
            deleteBtn.remove();
        }
        const categorySelect = clone.querySelector(".row-category");
        categorySelect.innerHTML = `
            <option value="Founder">Founder</option>
            <option value="Option pool">Option pool</option>
            <option value="Investor">Investor</option>
            <option value="Other">Other</option>
        `;
        categorySelect.value = row.category;
        categorySelect.onchange = (e) => updateRow(row.id, 'category', e.target.value);
        
        const sharesInput = clone.querySelector(".row-shares");
        sharesInput.value = formatNumberWithCommas(row.shares);
        sharesInput.oninput = (e) => formatInputLive(e.target);
        sharesInput.onchange = (e) => updateRow(row.id, 'shares', e.target.value);
        
        clone.querySelector(".row-pct").textContent = pctText;
        container.appendChild(clone);
    });

    const footer = document.getElementById("cap-table-footer");
    footer.className = "card-footer-total";
    footer.innerHTML = `
        <span style="font-family: 'Inter', sans-serif; font-size: 14px; color: #444266;">Total fully diluted shares</span>
        <span class="footer-total-value" style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #0d0a40;">${formatNumberWithCommas(totalSharesS0)}</span>
    `;
};

const renderSAFEs = (errors = {}) => {
    const container = document.getElementById("safes-body");
    if (!container) return;
    container.innerHTML = "";
    const safeRows = state.rowData.filter((r) => r.type === CapTableRowType.Safe);
    const showDelete = safeRows.length > 1;
    const template = document.getElementById("safe-card-template");
    let totalInv = 0;
    
    safeRows.forEach((row, idx) => {
        totalInv += row.investment;
        const isMfnRow = isMFN(row);
        const effectiveCap = getCapForSafe(idx, safeRows);
        const displayCap = isMfnRow ? effectiveCap : row.cap;
        
        const clone = template.content.cloneNode(true);
        const nameInput = clone.querySelector(".safe-name-input");
        nameInput.value = row.name;
        nameInput.onchange = (e) => updateRow(row.id, 'name', e.target.value);
        
        const deleteBtn = clone.querySelector(".row-trash-btn");
        if (showDelete) {
            deleteBtn.innerHTML = TRASH_ICON;
            deleteBtn.onclick = () => deleteRow(row.id);
        } else {
            deleteBtn.remove();
        }
        
        const invInput = clone.querySelector(".safe-investment");
        invInput.value = formatNumberWithCommas(row.investment);
        invInput.oninput = (e) => formatInputLive(e.target);
        invInput.onchange = (e) => updateRow(row.id, 'investment', e.target.value);
        
        const capInput = clone.querySelector(".safe-cap");
        capInput.value = formatNumberWithCommas(displayCap);
        if (isMfnRow) capInput.readOnly = true;
        capInput.oninput = (e) => formatInputLive(e.target);
        capInput.onchange = (e) => updateRow(row.id, 'cap', e.target.value);
        
        const discountInput = clone.querySelector(".safe-discount-input");
        discountInput.value = row.discount === 0 ? "" : Math.round(row.discount * 100);
        discountInput.oninput = (e) => formatDiscountLive(e.target);
        discountInput.onchange = (e) => updateRow(row.id, 'discount', e.target.value);
        
        const typeSelect = clone.querySelector(".safe-type");
        typeSelect.value = row.conversionType;
        typeSelect.onchange = (e) => updateRow(row.id, 'conversionType', e.target.value);
        
        const calcBtn = clone.querySelector(".btn-calc");
        if (calcBtn) {
            calcBtn.dataset.id = row.id;
            calcBtn.onclick = (e) => window.calculateSafeDiscount_UI(e.target);
        }
        
        // Show/hide notes based on SAFE type and configuration
        const noteElement = clone.querySelector(".safe-conversion-note");
        const mfnNoteElement = clone.querySelector(".safe-mfn-note");
        const mfnDiscountNoteElement = clone.querySelector(".safe-mfn-discount-note");
        
        const isMfnType = row.conversionType === 'mfn';
        const hasNoCap = (!row.cap || row.cap === 0) && (!row.discount || row.discount === 0);
        const hasDiscount = row.discount > 0;
        
        if (isMfnType) {
            // MFN SAFE
            if (noteElement) noteElement.style.display = "none";
            
            if (effectiveCap === 0) {
                if (hasDiscount) {
                    // MFN with discount and no inherited cap
                    if (mfnNoteElement) mfnNoteElement.style.display = "none";
                    if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "block";
                } else {
                    // MFN with NO discount and no inherited cap
                    if (mfnNoteElement) mfnNoteElement.style.display = "block";
                    if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "none";
                }
            } else {
                // MFN that inherited a cap
                if (mfnNoteElement) mfnNoteElement.style.display = "none";
                if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "none";
            }
        } else {
            // Pre-money or Post-money SAFE: show conversion note if no cap/discount
            if (noteElement) noteElement.style.display = hasNoCap ? "block" : "none";
            if (mfnNoteElement) mfnNoteElement.style.display = "none";
            if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "none";
        }
        
        // Inline validation error for SAFEs
        const safeErrorEl = clone.querySelector(".safe-error-msg");
        if (safeErrorEl && errors[row.id]) {
            safeErrorEl.textContent = errors[row.id];
            safeErrorEl.style.display = "block";
            // Highlight relevant inputs
            invInput.classList.add("input-invalid-border");
            capInput.classList.add("input-invalid-border");
        }
        
        container.appendChild(clone);
    });

    const safesSection = document.getElementById("safes-body").parentElement;
    let totalRow = safesSection.querySelector(".card-footer-total");
    if (!totalRow) {
        totalRow = document.createElement("div");
        totalRow.className = "card-footer-total";
        safesSection.appendChild(totalRow);
    }
    
    totalRow.innerHTML = `
        <span style="font-family: 'Inter', sans-serif; font-size: 14px; color: #444266;">Total SAFE investment</span>
        <span class="footer-total-value" style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #0d0a40;">${formatUSDWithCommas(totalInv)}</span>
    `;
};

const renderSeriesInvestors = () => {
    const container = document.getElementById("series-body");
    if (!container) return;
    container.innerHTML = "";
    const seriesInvestors = state.rowData.filter((r) => r.type === CapTableRowType.Series);
    const showDelete = seriesInvestors.length > 1;
    const template = document.getElementById("series-investor-template");
    let totalInv = 0;
    
    seriesInvestors.forEach((row) => {
        totalInv += row.investment;
        const clone = template.content.cloneNode(true);
        
        const nameInput = clone.querySelector(".investor-name");
        nameInput.value = row.name;
        nameInput.onchange = (e) => updateRow(row.id, 'name', e.target.value);
        
        const invInput = clone.querySelector(".series-investor-input");
        invInput.value = formatNumberWithCommas(row.investment);
        invInput.oninput = (e) => formatInputLive(e.target);
        invInput.onchange = (e) => updateRow(row.id, 'investment', e.target.value);
        
        const deleteBtn = clone.querySelector(".row-trash-btn");
        if (showDelete) {
            deleteBtn.innerHTML = TRASH_ICON;
            deleteBtn.onclick = () => deleteRow(row.id);
        } else {
            deleteBtn.remove();
        }
        
        container.appendChild(clone);
    });

    const seriesContainer = document.getElementById("series-container");
    const seriesSection = seriesContainer.parentElement;
    let totalRow = seriesSection.querySelector(".card-footer-total-series");
    if (!totalRow) {
        totalRow = document.createElement("div");
        totalRow.className = "card-footer-total card-footer-total-series";
        seriesContainer.insertAdjacentElement("afterend", totalRow);
    }
    totalRow.innerHTML = `
        <span style="font-family: 'Inter', sans-serif; font-size: 14px; color: #444266;">Total raised</span>
        <span class="footer-total-value" style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #0d0a40;">${formatUSDWithCommas(totalInv)}</span>
    `;
};

const getRowData = (data) => {
    const rows = [];
    if (!data) return rows;

    // Build auto-labels for common rows
    const catTotals = {};
    if (data.common) data.common.forEach(r => { const c = r.category || 'Other'; catTotals[c] = (catTotals[c] || 0) + 1; });
    const catCounts = {};

    if (data.common) {
        data.common.forEach((r) => {
            const cat = r.category || 'Other';
            catCounts[cat] = (catCounts[cat] || 0) + 1;
            const autoName = catTotals[cat] > 1 ? `${cat} ${catCounts[cat]}` : cat;
            rows.push({
                id: r.id,
                name: (r.name && r.name.trim()) ? r.name.trim() : autoName,
                category: r.category || "Other",
                shares: r.shares || 0,
                ownershipPct: r.ownershipPct || 0,
                isPricedOrSafe: false,
            });
        });
    }

    if (data.safes) {
        data.safes.forEach((s) => {
            rows.push({
                id: s.id,
                name: s.name,
                category: "Investor", // Branding for SAFEs in the table
                shares: s.shares || 0,
                ownershipPct: s.ownershipPct || 0,
                isPricedOrSafe: true,
                pps_val: s.pps,
                conversionType: s.conversionType,
                isMFN: isMFN(s),
            });
        });
    }

    if (data.series) {
        data.series.forEach((se) => {
            rows.push({
                id: se.id,
                name: se.name || "New Investor",
                category: "Investor",
                shares: se.shares || 0,
                ownershipPct: se.ownershipPct || 0,
                isPricedOrSafe: true,
                pps_val: se.pps,
            });
        });
    }

    if (data.refreshedOptionsPool && data.refreshedOptionsPool.shares > 0) {
        const esopRow = state.rowData?.find(r => r.id === "UnusedOptionsPool");
        const esopName = esopRow?.name || "Option pool";
        rows.push({
            id: "UnusedOptionsPool",
            name: esopName,
            category: "Option pool",
            shares: data.refreshedOptionsPool.shares || 0,
            ownershipPct: data.refreshedOptionsPool.ownershipPct || 0,
            isPricedOrSafe: false,
        });
    }

    return rows;
};

const getRowColor = (row) => {
    const { id, category, name, isPricedOrSafe } = row;
    
    // Option pool - yellow
    if (id === "UnusedOptionsPool" || category === "OptionPool") {
        return "#f6c343";
    }
    
    // Founders - purple
    if (category === "Founder" || (name && name.toLowerCase().includes("founder"))) {
        return "#5f46ff";
    }

    // SAFEs - darker purple
    if (isPricedOrSafe && (id.includes("SAFE") || name.includes("SAFE"))) {
        return "#7464ff";
    }
    
    // Regular investors - blue shades (alternate)
    if (category === "Investor" || isPricedOrSafe) {
        // Use a simple hash of the ID to determine color variation
        const charSum = id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return charSum % 2 === 0 ? "#60a5fa" : "#93c5fd";
    }
    
    // Default
    return "#5f46ff";
};

const renderBreakdownTable = (preData, postData, pps) => {
    const container = document.getElementById("post-round-table");
    if (!container) return;
    container.innerHTML = "";
    const template = document.getElementById("breakdown-row-template");

    const preRows = getRowData(preData);
    const postRows = getRowData(postData);
    const preSharesValid = preData?.total?.shares > 0;
    const postSharesValid = postData?.total?.shares > 0;

    const allIds = Array.from(new Set([...preRows.map((r) => r.id), ...postRows.map((r) => r.id)]));

    allIds.forEach((id) => {
        const pre = preRows.find((r) => r.id === id) || { shares: 0, ownershipPct: 0, isVirtual: true };
        const post = postRows.find((r) => r.id === id) || { shares: 0, ownershipPct: 0 };

        const prePctLabel = preSharesValid && !pre.isVirtual && pre.shares > 0 ? safeFormatPercent(pre.ownershipPct) : "—";
        const postPctLabel = postSharesValid && post.shares > 0 ? safeFormatPercent(post.ownershipPct) : "—";

        const clone = template.content.cloneNode(true);
        const tr = clone.querySelector("tr");
        tr.id = `row-${id}`;
        
        // Get the color for this row
        const rowColor = getRowColor(post);
        
        // Set the color on the name-dot before appending
        const nameDot = clone.querySelector(".name-dot");
        if (nameDot) {
            nameDot.style.backgroundColor = rowColor;
        }
        
        clone.querySelector(".row-display-name").textContent = post.name || pre.name || "—";
        
        let tagsHtml = "";
        if (post.isPricedOrSafe && post.category === "Investor") {
            const safeMatch = postData.safes?.find(s => s.id === id);
            if (safeMatch) {
                if (safeMatch.isMFN) tagsHtml += `<span class="sc-tag sc-tag-mfn">MFN SAFE</span>`;
                else if (safeMatch.conversionType === "pre") tagsHtml += `<span class="sc-tag sc-tag-pre">Pre-money SAFE</span>`;
                else tagsHtml += `<span class="sc-tag sc-tag-post">Post-money SAFE</span>`;
            }
        }
        if (post.id === "UnusedOptionsPool" && postSharesValid && pre.shares >= 0 && post.shares > pre.shares + 1) {
            tagsHtml += `<span class="sc-tag sc-tag-pool">Pool top-up</span>`;
        }
        clone.querySelector(".row-tags").innerHTML = tagsHtml;

        clone.querySelector(".row-pre-shares").textContent = safeFormatNumber(pre.shares);
        clone.querySelector(".row-post-shares").textContent = safeFormatNumber(post.shares);
        clone.querySelector(".row-pre-pct").textContent = prePctLabel;
        clone.querySelector(".row-post-pct").textContent = postPctLabel;
        const ppsLabel = post.shares > 0 ? safeFormatPPS(post.pps_val) : "—";
        clone.querySelector(".row-pps").textContent = ppsLabel;

        container.appendChild(clone);
    });

    const totalTr = document.createElement("tr");
    totalTr.className = "total-row"; 

    totalTr.innerHTML = `
        <td style="font-weight: 600;">Total</td>
        <td class="right" style="font-weight: 600;">${safeFormatNumber(preData.total.shares)}</td>
        <td class="right" style="font-weight: 600;">${safeFormatNumber(postData.total.shares)}</td>
        <td class="right" style="font-weight: 600;">${preSharesValid && preData.total.shares > 0 ? "100.00%" : "—"}</td>
        <td class="right" style="font-weight: 600;">${postSharesValid && postData.total.shares > 0 ? "100.00%" : "—"}</td>
        <td class="right"></td>
    `;
    container.appendChild(totalTr);
};

const renderPieChart = (postRound) => {
    const container = document.getElementById("pie-chart-container");
    if (!container) return;

    if (window.pieChartInstance) {
        window.pieChartInstance.destroy();
        window.pieChartInstance = null;
    }

    const totalShares = postRound?.total?.shares || 0;
    if (totalShares <= 0) { container.innerHTML = ''; return; }

    const rowData = getRowData(postRound);
    if (!rowData.length) { container.innerHTML = ''; return; }

    const categoryPalettes = {
        "Founder": ["#475569", "#64748b", "#94a3b8"],
        "Investor": ["#3b82f6", "#60a5fa", "#93c5fd"],
        "Option pool": ["#f6c343", "#f9d77e", "#fbe8b0"],
        "Other": ["#64748b", "#94a3b8", "#cbd5e1"]
    };
    const categoryCounters = {};
    const catTotals = {};
    const catCounts = {};
    rowData.forEach(r => { const c = r.category || 'Other'; catTotals[c] = (catTotals[c] || 0) + 1; });

    const segments = rowData.map(r => {
        const cat = r.category || 'Other';
        if (!categoryCounters[cat]) categoryCounters[cat] = 0;
        const palette = categoryPalettes[cat] || categoryPalettes["Other"];
        const color = palette[categoryCounters[cat] % palette.length];
        categoryCounters[cat]++;
        catCounts[cat] = (catCounts[cat] || 0) + 1;
        const label = catTotals[cat] > 1 ? `${cat} ${catCounts[cat]}` : cat;
        const pct = (r.shares / totalShares) * 100;
        return { label, color, pct, shares: r.shares, id: r.id };
    });

    // Build stacked bar with new classes
    const barSegments = segments.map(s => `
        <div class="sc-stack-seg"
             title="${s.label}: ${s.pct.toFixed(2)}%"
             style="width:${s.pct}%;background:${s.color};"
             onclick="window.scrollToRow('${s.id}')">
        </div>
    `).join('');

    // Build legend with new structure
    const legendItems = segments.map(s => `
        <div class="sc-legend-item" onclick="window.scrollToRow('${s.id}')" style="cursor:pointer;">
            <div class="sc-legend-left">
                <span class="sc-legend-swatch" style="background:${s.color};"></span>
                <span class="sc-legend-name">${s.label}</span>
            </div>
            <span class="sc-legend-pct">${s.pct.toFixed(2)}%</span>
        </div>
    `).join('');

    // Render bar chart
    const barContainer = document.querySelector('.sc-stack-bar');
    if (barContainer) {
        barContainer.innerHTML = barSegments;
    }

    // Render legend
    const legendContainer = document.querySelector('.sc-legend');
    if (legendContainer) {
        legendContainer.innerHTML = legendItems;
    }
};

window.scrollToRow = (id) => {
    const rowEl = document.getElementById(`row-${id}`);
    if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        rowEl.classList.add('highlight-row');
        rowEl.classList.add('highlight-flash');
        setTimeout(() => {
            rowEl.classList.remove('highlight-row');
            rowEl.classList.remove('highlight-flash');
        }, 2000);
    }
};



const generateSummaryText = (preRound, postRound, pricedConversion, state, postSafeFounderPct) => {
    const roundName = state.roundName || "priced round";
    const newMoneyRaised = pricedConversion.totalSeriesInvestment;
    const preMoney = state.preMoney;
    
    // 1. Calculate the actual original founder percentage (strictly pre-SAFE/pre-funding)
    // to detect if majority control is lost across the entire modeling journey.
    const initialCommonRows = state.rowData.filter(r => r.type === CapTableRowType.Common);
    const initialTotalS = initialCommonRows.reduce((a, r) => a + r.shares, 0);
    const initialFounderS = initialCommonRows
        .filter(r => r.category === "Founder")
        .reduce((a, r) => a + r.shares, 0);
    const originalFounderPct = initialTotalS > 0 ? initialFounderS / initialTotalS : 0;

    const foundersPost = postRound.common.filter((c) => c.category === "Founder");
    const totalFounderPctPost = foundersPost.reduce((a, f) => a + f.ownershipPct, 0);
    
    // totalFounderPctPre here refers to the state "before this round" (Post-SAFE)
    const totalFounderPctPre = postSafeFounderPct !== undefined ? postSafeFounderPct : 0;

    const safesCount = state.rowData.filter(r => r.type === CapTableRowType.Safe).length;
    const totalSafeInvestment = state.rowData
        .filter(r => r.type === CapTableRowType.Safe)
        .reduce((sum, s) => sum + s.investment, 0);

    const summaries = [];
    
    summaries.push(`You are modeling a ${roundName} round raising ${formatUSDWithCommas(newMoneyRaised)} at a ${formatUSDWithCommas(preMoney)} pre-money valuation. Founder ownership changes from ${safeFormatPercent(originalFounderPct)} (initially) to ${safeFormatPercent(totalFounderPctPost)} after all conversions.`);
    
    if (safesCount > 0) {
        summaries.push(`${safesCount} SAFE${safesCount > 1 ? 's' : ''} totaling ${formatUSDWithCommas(totalSafeInvestment)} will convert.`);
    }
    
    // Logic: If founders started with majority (>50%) and ended without it (<50%), show warning.
    // We check against the original founder percentage because SAFEs might have already 
    // pushed them close to the line, and the user expects a warning if the total process loses majority.
    const numericPostPct = Number(totalFounderPctPost);
    if (originalFounderPct >= 0.5 && numericPostPct < 0.49995) {
        summaries.push(`Founders have dropped below 50% majority ownership in this modeling scenario.`);
    }
    
    // Only show pool top-up if a positive target was actually specified
    const targetPool = Number(state.targetOptionsPool);
    if (targetPool > 0 && pricedConversion.increaseInOptionsPool > 0) {
        summaries.push(`The model includes an option pool top-up to reach the target of ${targetPool}%, which issued additional shares pre ${roundName}.`);
    }
    
    return summaries;
};

let aiLoadingTimeout = null;

const renderAIAdvisor = (preRound, postRound, pricedConversion, state, strictlyPreFounderPct) => {
    const container = document.getElementById("ai-insights-container");
    if (!container) return;


    if (aiLoadingTimeout) clearTimeout(aiLoadingTimeout);

    const newMoneyRaised = pricedConversion.totalSeriesInvestment;
    const preMoney = state.preMoney;

    if (preMoney <= 0 || newMoneyRaised <= 0) {
        container.innerHTML = `<p class="card-subtext" style="font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 400; line-height: 1.5; color: #9ca3af; margin: 0.25rem 0 0 0;">Insights will appear once you enter your priced round terms.</p>`;
        return;
    }


    container.innerHTML = `
        <div class="ai-skeleton-loader" style="display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0;">
            <div class="ai-skeleton-line" style="width: 100%; height: 12px; background-color: #e2e8f0; border-radius: 4px;"></div>
            <div class="ai-skeleton-line" style="width: 85%; height: 12px; background-color: #e2e8f0; border-radius: 4px;"></div>
            <div class="ai-skeleton-line" style="width: 60%; height: 12px; background-color: #e2e8f0; border-radius: 4px;"></div>
        </div>
    `;

    aiLoadingTimeout = setTimeout(() => {
        const summaries = generateSummaryText(preRound, postRound, pricedConversion, state, strictlyPreFounderPct);
        const roundName = state.roundName || "priced round";
        
        // Convert plain text summaries to styled HTML for the UI
        const htmlInsights = summaries.map(text => {
            // Apply bold styling to numbers/money and ownership percentages
            let styled = text
                .replace(/(\$[\d,]+)/g, '<strong style="color: #0d0a40; font-weight: 600; font-family: \'Inter\', sans-serif;">$1</strong>')
                .replace(/(\d+\.\d+%)|(\d+%)|(\d+ shares)/g, '<strong style="color: #0d0a40; font-weight: 600; font-family: \'Inter\', sans-serif;">$1</strong>')
                .replace(new RegExp(roundName, 'g'), `<strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${roundName}</strong>`);
            
            if (text.includes("dropped below 50%")) {
                return `
                    <div class="insight-item" style="color: #0d0a40; margin: 0.75rem 0 0 0; font-family: 'Inter', sans-serif;">
                        <div class="insight-danger" style="color: #dc2626; font-weight: 500; display: flex; align-items: center; gap: 0.5rem; margin-bottom: 20px;">${text}</div>
                    </div>
                `;
            }
            
            return `<p style="margin: 0 0 0.35rem 0; font-family: 'Inter', sans-serif; line-height: 1.6; font-size: 14px; color: #444266;">${styled}</p>`;
        });

        container.innerHTML = htmlInsights.join('');
    }, 600);
};

const CATEGORY_ORDER = { "Founder": 0, "Option pool": 1, "Investor": 2, "Other": 3 };

window.updateRow = (id, field, value) => {
    const row = state.rowData.find((r) => r.id === id);
    if (!row) return;
    if (field === "shares" || field === "investment" || field === "cap") {
        row[field] = stringToNumber(value);
    } else if (field === "discount") {
        row[field] = stringToNumber(value) / 100;
    } else {
        row[field] = value;
        if (field === "conversionType" && value === "mfn") {
            row.cap = 0;
            row.discount = 0;
        }
    }
    // Re-sort common rows by category order when category changes
    if (field === "category") {
        const commonRows = state.rowData.filter((r) => r.type === CapTableRowType.Common);
        const safeRows = state.rowData.filter((r) => r.type === CapTableRowType.Safe);
        const seriesRows = state.rowData.filter((r) => r.type === CapTableRowType.Series);
        commonRows.sort((a, b) => {
            const aOrder = CATEGORY_ORDER[a.category] ?? 99;
            const bOrder = CATEGORY_ORDER[b.category] ?? 99;
            return aOrder - bOrder;
        });
        state.rowData = [...commonRows, ...safeRows, ...seriesRows];
    }
    updateUI({ compute: false });
};

window.addRow = (type) => {
    const id = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 11);
    if (type === "common") {
        const commonCount = state.rowData.filter(r => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool").length + 1;
        state.rowData.push({
            id,
            type,
            name: `Shareholder ${commonCount}`,
            shares: 0,
            category: "Investor",
        });
    } else if (type === CapTableRowType.Safe) {
        state.rowData.push({
            id,
            type,
            name: "New SAFE",
            investment: 0,
            cap: 0,
            discount: 0,
            conversionType: "post",
        });
    } else if (type === CapTableRowType.Series) {
        state.rowData.push({ id, type, name: "New Investor", investment: 0 });
    }
    updateUI({ compute: false });
};

window.deleteRow = (id) => {
    const row = state.rowData.find((r) => r.id === id);
    if (!row) return;

    if (id === "UnusedOptionsPool") {
        state.targetOptionsPool = 0;
        const targetInput = document.getElementById("target-options-input");
        if (targetInput) targetInput.value = "0";
    } else {
        if (row.type === CapTableRowType.Common) {
            const commonCount = state.rowData.filter(
                (r) => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool"
            ).length;
            if (commonCount <= 1) return;
        } else if (row.type === CapTableRowType.Safe) {
            const safeCount = state.rowData.filter((r) => r.type === CapTableRowType.Safe).length;
            if (safeCount <= 1) return;
        } else if (row.type === CapTableRowType.Series) {
            const seriesCount = state.rowData.filter((r) => r.type === CapTableRowType.Series).length;
            if (seriesCount <= 1) return;
        }
    }

    state.rowData = state.rowData.filter((r) => r.id !== id);
    updateUI({ compute: false });
};

window.togglePricedRound = () => {
    state.pricedRounds = state.pricedRounds === 0 ? 1 : 0;
    const btn = document.getElementById("toggle-priced-btn");
    if (btn) btn.textContent = state.pricedRounds > 0 ? "Remove Priced Round" : "Add Priced Round";
    updateUI({ compute: false });
};

window.updateGlobal = (field, value) => {
    if (field === "preMoney" || field === "targetOptionsPool") {
        state[field] = stringToNumber(value);
    } else {
        state[field] = value;
    }
    updateUI({ compute: false });
};

window.calculateSafeDiscount_UI = (btn) => {
    const id = btn.dataset.id;
    const safe = state.rowData.find(r => r.id === id);
    if (!safe) return;

    if (state.preMoney <= 0) {
        // Valuation error will already be shown by updateUI, but let's make sure it's clear
        updateUI({ compute: false });
        return;
    }

    if (safe.cap <= 0) {
        // Show error specifically for this SAFE
        renderSAFEs({ [safe.id]: "Enter a Valuation Cap first to calculate discount." });
        return;
    }

    // Formula: Discount = 1 - (Cap / Pre-money)
    let discount = 1 - (safe.cap / state.preMoney);
    
    // Clamp discount between 0 and 1 (0% to 100%)
    discount = Math.max(0, Math.min(1, discount));
    
    const discountPct = Math.round(discount * 100);
    
    updateRow(safe.id, 'discount', discountPct);
    
    showToast(`Discount calculated based on Cap: ${discountPct}%`, "success");
};

window.initSAFEApp = () => {
    try {
        updateUI();
    } catch (e) {
        console.error("Initialization error:", e);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    if (!window.manualInitSAFE) {
        window.initSAFEApp();
    }
});

/* 
================================================================
PART 3: PDF & INTEGRATION
Email, Toast, and PDF generation logic.
================================================================
*/
// ⚠️ DEPLOY TODO: change BASE_URL to your deployed backend URL before going live.
// Local dev points at the server.js PDF backend on port 3005.
const BASE_URL = "https://safe-calculator-backend.onrender.com";

// ── Webflow lead form, shown as a popup ────────────────────────────────────
// Clicking "Download" opens the native Webflow form as a centered popup.
// Because the form is VISIBLE, Cloudflare Turnstile works and the user can
// submit it — the lead is stored in Webflow (Forms tab). On a successful
// submit we generate and download the PDF. If the form isn't on the page,
// showEmailModal() falls back to the built-in modal.
const WEBFLOW_FORM_SELECTOR = "#wf-form-Safe-calculator-page";

// True for forms we must NEVER pick: our own built-in modal, or anything inside
// the OLD duplicate calculator embed (#safe-calculator-root) still on the page.
function _isExcludedLeadForm(f) {
    return !f
        || f.id === 'email-modal'
        || !!f.closest('#email-modal')
        || !!f.closest('#safe-calculator-root');
}

// Normalized field "names" of a form (lowercased, non-letters stripped).
function _formFieldKeys(f) {
    return Array.from(f.querySelectorAll('input,select,textarea'))
        .map((i) => (i.getAttribute('name') || i.id || '').toLowerCase().replace(/[^a-z]/g, ''))
        .filter(Boolean);
}

function findWebflowLeadForm() {
    const candidates = Array.from(document.querySelectorAll('form')).filter((f) => !_isExcludedLeadForm(f));

    // 1. Prefer the user's lead form: the one with a single "Name" field (NOT
    //    First-Name/Last-Name). This is the form they actually want used, even
    //    if other forms exist on the page.
    const nameForm = candidates.find((f) => {
        const keys = _formFieldKeys(f);
        return keys.includes('name') || keys.includes('fullname');
    });
    if (nameForm) return nameForm;

    // 2. Try the exact Webflow selectors.
    let form = document.querySelector(WEBFLOW_FORM_SELECTOR);
    if (!_isExcludedLeadForm(form)) return form;

    form = document.querySelector('form[data-name="Safe calculator page"]');
    if (!_isExcludedLeadForm(form)) return form;

    // 3. Any Webflow form wrapper (.w-form), preferring one with an email field.
    const wForms = candidates.filter((f) => f.closest('.w-form'));
    const withEmail = wForms.find((f) => _formFieldKeys(f).some((k) => k.includes('email')));
    if (withEmail) return withEmail;
    if (wForms.length) return wForms[0];

    // 4. Any remaining form on the page.
    if (candidates[0]) return candidates[0];

    return null;
}

function getWebflowWrap() {
    const form = findWebflowLeadForm();
    return form ? (form.closest(".w-form") || form) : null;
}

// Keep the Webflow form out of the page flow until the popup opens.
function initWebflowLeadPopup() {
    const wrap = getWebflowWrap();
    if (wrap) wrap.style.display = "none";
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWebflowLeadPopup);
} else {
    initWebflowLeadPopup();
}

let _wfBackdrop = null;
let _wfOnSuccess = null;

window.closeWebflowLeadPopup = function () {
    const wrap = getWebflowWrap();
    if (wrap) wrap.style.display = "none";
    if (_wfBackdrop) _wfBackdrop.style.display = "none";
};

// Inject (once) a stylesheet that makes the Webflow lead form look identical to
// the original built-in email modal — same header, uppercase labels, input
// styling, checkbox card and purple primary button. Everything is scoped under
// `.sv-wf-modal` so it only affects the popup, never the rest of the page.
function ensureWfModalStyles() {
    if (document.getElementById("sv-wf-modal-style")) return;
    const css = `
.sv-wf-modal *{box-sizing:border-box;}
.sv-wf-modal .sv-wf-modal-header{display:flex;justify-content:space-between;align-items:center;padding:24px 28px 18px 28px;border-bottom:1px solid #f3f0ff;}
.sv-wf-modal .sv-wf-modal-header h3{font-size:18px;font-weight:600;color:#0d0a40;letter-spacing:-0.01em;margin:0;font-family:'Inter',sans-serif;}
.sv-wf-modal .sv-wf-modal-close{background:none;border:none;font-size:24px;color:#9ca3af;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:all .2s ease;line-height:1;padding:0;flex-shrink:0;}
.sv-wf-modal .sv-wf-modal-close:hover{background:#f3f0ff;color:#0d0a40;}
.sv-wf-modal > form,.sv-wf-modal > .w-form-done,.sv-wf-modal > .w-form-fail{padding:24px 28px 28px !important;margin:0 !important;}
.sv-wf-modal form > div{margin-bottom:0;}
.sv-wf-modal label:not(.w-checkbox):not(.w-form-label){font-size:11px;font-weight:600;color:#444266;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;display:block;font-family:'Inter',sans-serif;}
.sv-wf-modal input[type=text],.sv-wf-modal input[type=email],.sv-wf-modal input[type=tel],.sv-wf-modal .w-input,.sv-wf-modal .w-select,.sv-wf-modal select,.sv-wf-modal textarea{display:block !important;width:100% !important;height:44px !important;padding:10px 14px !important;font-size:14px !important;font-family:'Inter',sans-serif !important;font-weight:400 !important;color:#0d0a40 !important;background:#fff !important;border:1px solid #eae7ff !important;border-radius:8px !important;outline:none !important;transition:all .2s ease !important;box-shadow:0 1px 2px rgba(13,10,64,0.04) !important;margin-bottom:16px !important;}
.sv-wf-modal input::placeholder{color:#a3a1c2 !important;}
.sv-wf-modal input[type=text]:focus,.sv-wf-modal input[type=email]:focus,.sv-wf-modal .w-input:focus{border-color:#5f46ff !important;box-shadow:0 0 0 3px rgba(95,70,255,.15) !important;}
.sv-wf-modal .w-checkbox{display:flex !important;align-items:flex-start;gap:10px;background:transparent !important;border:none !important;border-radius:0 !important;padding:0 !important;margin-bottom:16px;}
.sv-wf-modal .w-checkbox label,.sv-wf-modal .w-form-label{text-transform:none !important;font-size:13px !important;font-weight:400 !important;color:#444266 !important;letter-spacing:normal !important;margin:0 !important;line-height:1.4 !important;font-family:'Inter',sans-serif !important;}
.sv-wf-modal input[type=checkbox]{width:16px !important;height:16px !important;margin-top:2px !important;accent-color:#5f46ff;flex-shrink:0;}
.sv-wf-modal .w-checkbox-input{margin-top:2px;}
.sv-wf-modal .sv-wf-note{font-size:11px;color:#9ca3af;margin:8px 0 16px 0;line-height:1.4;font-family:'Inter',sans-serif;}
.sv-wf-modal .w-button,.sv-wf-modal input[type=submit],.sv-wf-modal button[type=submit]{height:46px !important;font-size:14px !important;font-weight:500 !important;border-radius:10px !important;background:#5f46ff !important;color:#fff !important;border:none !important;width:100% !important;cursor:pointer !important;transition:all .2s ease !important;box-shadow:0 4px 12px rgba(95,70,255,.15) !important;font-family:'Inter',sans-serif !important;margin-top:4px !important;}
.sv-wf-modal .w-button:hover,.sv-wf-modal input[type=submit]:hover,.sv-wf-modal button[type=submit]:hover{background:#4a34e0 !important;transform:translateY(-1px);box-shadow:0 6px 16px rgba(95,70,255,.25) !important;}
.w-form-done-spinner{width:28px;height:28px;border:3px solid #eae7ff;border-top-color:#5f46ff;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}`;
    const tag = document.createElement("style");
    tag.id = "sv-wf-modal-style";
    tag.textContent = css;
    document.head.appendChild(tag);
}

// Text shown in the original built-in modal — mirror it onto the Webflow form
// so the wording matches exactly. Keyed by the field's name/id (lowercased,
// non-letters stripped). Only rewrites a standalone <label>, never a wrapping
// checkbox label, so it can't blank anything out.
const WF_LABEL_TEXT = {
    "name": "Name",
    "firstname": "First name",
    "lastname": "Last name",
    "email": "Work email",
    "company": "Company name",
    "companyname": "Company name",
};

function applyWfModalText(form) {
    // Header title is injected separately. Here we fix field labels + button.
    form.querySelectorAll("label").forEach((label) => {
        if (label.querySelector("input,select,textarea")) return; // checkbox label — leave it
        let key = (label.getAttribute("for") || "").toLowerCase();
        if (!key) {
            const inp = label.parentElement && label.parentElement.querySelector("input,select,textarea");
            if (inp) key = (inp.getAttribute("name") || inp.id || "").toLowerCase();
        }
        key = key.replace(/[^a-z]/g, "");
        if (WF_LABEL_TEXT[key]) label.textContent = WF_LABEL_TEXT[key];
    });
}

// Opens the Webflow form as a centered modal. Returns false if the form isn't
// on the page (caller then falls back to the built-in modal).
function openWebflowLeadPopup(onSuccess) {
    const form = findWebflowLeadForm();
    if (!form) return false;
    const wrap = form.closest(".w-form") || form;
    _wfOnSuccess = onSuccess;

    ensureWfModalStyles();

    if (!_wfBackdrop) {
        _wfBackdrop = document.createElement("div");
        _wfBackdrop.style.cssText =
            "position:fixed;inset:0;background:rgba(13,10,64,0.5);z-index:99998;backdrop-filter:blur(4px);animation:fadeIn 0.2s ease;";
        _wfBackdrop.addEventListener("click", window.closeWebflowLeadPopup);
        document.body.appendChild(_wfBackdrop);
    }
    _wfBackdrop.style.display = "block";

    // Ensure the form is visible and any done/fail states are hidden when opening
    form.style.display = "block";
    const doneEl = wrap.querySelector(".w-form-done");
    if (doneEl) {
        doneEl.style.display = "none";
        if (doneEl._originalContent) {
            doneEl.innerHTML = doneEl._originalContent;
        }
    }
    const failEl = wrap.querySelector(".w-form-fail");
    if (failEl) failEl.style.display = "none";

    const submitBtn = form.querySelector('input[type="submit"]') || form.querySelector('button[type="submit"]') || form.querySelector('.w-button');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "";
        submitBtn.style.pointerEvents = "";
        // Match the old modal's button label exactly.
        if (submitBtn.tagName === 'INPUT') {
            submitBtn.value = "Download the report";
        } else {
            submitBtn.textContent = "Download the report";
        }
    }

    // Neutralize any leftover hide-CSS on the form itself (e.g. opacity:0 /
    // left:-9999px from the embed) so it's fully visible inside the popup.
    form.style.cssText =
        "position:static;left:auto;top:auto;opacity:1;visibility:visible;pointer-events:auto;width:100%;";

    // Tag the wrap so the injected `.sv-wf-modal` stylesheet themes the form to
    // match the built-in email modal (header, labels, inputs, button).
    wrap.classList.add("sv-wf-modal");

    // Inject the modal header (title + close ✕) once, matching the old modal.
    if (!wrap.querySelector(".sv-wf-modal-header")) {
        const header = document.createElement("div");
        header.className = "sv-wf-modal-header";
        header.innerHTML =
            '<h3>Download the ownership report</h3>' +
            '<button type="button" class="sv-wf-modal-close" aria-label="Close">&times;</button>';
        header.querySelector(".sv-wf-modal-close")
            .addEventListener("click", window.closeWebflowLeadPopup);
        wrap.insertBefore(header, wrap.firstChild);
    }

    // Mirror the old modal's field wording onto the Webflow labels + button.
    applyWfModalText(form);

    // Show the form centered as a card — VISIBLE so Turnstile can render/solve.
    // Padding lives in the stylesheet (header + form), so the card itself has none.
    wrap.style.cssText =
        "display:block;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
        "z-index:99999;box-sizing:border-box;background:#fff;padding:0;border-radius:16px;border:1px solid #eae7ff;" +
        "max-width:480px;width:calc(100% - 32px);max-height:90vh;overflow:auto;" +
        "box-shadow:0 20px 48px rgba(13,10,64,0.16);font-family:'Inter',sans-serif;";

    // Intercept submit on the Webflow form to show a loading state
    if (!form._wfSubmitObserved) {
        form._wfSubmitObserved = true;
        form.addEventListener("submit", () => {
            const btn = form.querySelector('input[type="submit"]') || form.querySelector('button[type="submit"]') || form.querySelector('.w-button');
            if (btn) {
                btn.setAttribute('data-wait', 'Generating...');
                btn.disabled = true;
                if (btn.tagName === 'INPUT') {
                    if (!btn._originalValue) btn._originalValue = btn.value;
                    btn.value = "Generating...";
                } else {
                    if (!btn._originalText) btn._originalText = btn.textContent;
                    btn.textContent = "Generating...";
                }
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            }
        });
    }

    // When Webflow shows its success state, fire the callback once (→ PDF).
    if (doneEl && !doneEl._svObserved) {
        doneEl._svObserved = true;
        const obs = new MutationObserver(async () => {
            if (getComputedStyle(doneEl).display !== "none") {
                const cb = _wfOnSuccess;
                _wfOnSuccess = null;
                if (typeof cb === "function") {
                    // Save the form's success markup so we can restore it on reopen.
                    if (!doneEl._originalContent) {
                        doneEl._originalContent = doneEl.innerHTML;
                    }
                    // Render the loader INSIDE this popup: the same popup now
                    // shows the spinner + % + ETA (no separate full-screen overlay).
                    _pdfLoaderTarget = doneEl;
                    try {
                        await cb();
                    } catch (err) {
                        console.error("PDF generation failed in Webflow flow:", err);
                    }
                }
                window.closeWebflowLeadPopup();
            }
        });
        obs.observe(doneEl, { attributes: true, attributeFilter: ["style"] });
    }
    return true;
}

// ---------------------------------------------------------------------------
// PDF loading UI: spinner + live percentage + estimated time remaining, driven
// by the backend's real streamed progress events. It renders INSIDE the lead-
// form popup when that flow is used (the same popup shows the progress), and
// falls back to a standalone centered modal card for the built-in email modal.
// ---------------------------------------------------------------------------
let _pdfLoaderEl = null;       // the element currently holding the loader UI
let _pdfLoaderOverlay = null;  // standalone backdrop+card (built-in modal flow)
let _pdfLoaderTarget = null;   // when set, render the loader INSIDE this element
let _pdfLoaderTimer = null;
let _pdfDisplay = 0;          // currently-shown %
let _pdfTarget = 0;           // % we're easing toward
let _pdfRealProgress = false; // true once the server sends a real progress event
let _pdfOpenTime = 0;         // when the loader opened (for cold-start messaging)
let _pdfRealStartTime = 0;    // when the first real progress event arrived
let _pdfRealStartPct = 0;
let _pdfEtaMs = null;         // estimated time remaining (ms), or null if unknown

function ensurePdfLoaderStyles() {
    if (document.getElementById("sv-pdf-loader-style")) return;
    const css = `
#sv-pdf-loader{position:fixed;inset:0;background:rgba(13,10,64,0.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100000;}
#sv-pdf-loader .sv-pdf-card{background:#fff;border:1px solid #eae7ff;border-radius:16px;padding:40px 32px;max-width:380px;width:calc(100% - 32px);box-shadow:0 20px 48px rgba(13,10,64,0.16);}
.sv-pdf-card,.sv-pdf-inline{display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;font-family:'Inter',-apple-system,sans-serif;}
.sv-pdf-inline{padding:16px 4px 6px;}
.sv-pdf-spinner{width:56px;height:56px;border:5px solid #eae7ff;border-top-color:#5f46ff;border-radius:50%;animation:sv-pdf-spin .8s linear infinite;}
.sv-pdf-pct{font-size:34px;font-weight:700;color:#0d0a40;letter-spacing:-0.02em;line-height:1;}
.sv-pdf-title{font-size:16px;font-weight:600;color:#0d0a40;}
.sv-pdf-sub{font-size:13px;color:#6c6c8a;}
@keyframes sv-pdf-spin{to{transform:rotate(360deg);}}`;
    const tag = document.createElement("style");
    tag.id = "sv-pdf-loader-style";
    tag.textContent = css;
    document.head.appendChild(tag);
}

function setPdfLoaderPct(pct) {
    if (!_pdfLoaderEl) return;
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const txt = _pdfLoaderEl.querySelector(".sv-pdf-pct");
    if (txt) txt.textContent = p + "%";
}

function showPdfLoader() {
    ensurePdfLoaderStyles();
    const inner =
        '<div class="sv-pdf-spinner"></div>' +
        '<div class="sv-pdf-pct">0%</div>' +
        '<div class="sv-pdf-title">Generating your report</div>' +
        '<div class="sv-pdf-sub">Preparing your report…</div>';
    if (_pdfLoaderTarget) {
        // Render the loader INSIDE the popup container (no separate overlay).
        _pdfLoaderTarget.innerHTML = '<div class="sv-pdf-inline">' + inner + '</div>';
        _pdfLoaderEl = _pdfLoaderTarget.querySelector(".sv-pdf-inline");
    } else {
        // Standalone centered modal card over a dimmed backdrop.
        if (!_pdfLoaderOverlay) {
            _pdfLoaderOverlay = document.createElement("div");
            _pdfLoaderOverlay.id = "sv-pdf-loader";
            _pdfLoaderOverlay.innerHTML = '<div class="sv-pdf-card">' + inner + "</div>";
            document.body.appendChild(_pdfLoaderOverlay);
        } else {
            _pdfLoaderOverlay.querySelector(".sv-pdf-card").innerHTML = inner;
        }
        _pdfLoaderOverlay.style.display = "flex";
        _pdfLoaderEl = _pdfLoaderOverlay.querySelector(".sv-pdf-card");
    }
    _pdfDisplay = 0;
    _pdfTarget = 0;
    _pdfRealProgress = false;
    _pdfOpenTime = Date.now();
    _pdfRealStartTime = 0;
    _pdfRealStartPct = 0;
    _pdfEtaMs = null;
    setPdfLoaderPct(0);
    setPdfLoaderStatus("Preparing your report…");
    clearInterval(_pdfLoaderTimer);
    const TICK = 120;
    _pdfLoaderTimer = setInterval(() => {
        // Before the server reports real progress (e.g. while waiting on a
        // cold-start wake-up), creep the target up to a small cap so the bar is
        // alive but honest. Once real events arrive, reportPdfProgress drives it.
        if (!_pdfRealProgress && _pdfTarget < 30) _pdfTarget += 0.5;
        // Always nudge the displayed value toward the target so it never freezes.
        if (_pdfDisplay < _pdfTarget) _pdfDisplay += Math.max(0.3, (_pdfTarget - _pdfDisplay) * 0.18);
        if (_pdfDisplay > 99) _pdfDisplay = 99;
        setPdfLoaderPct(_pdfDisplay);

        // Status / estimated-time line.
        if (!_pdfRealProgress) {
            // No real signal yet — likely a cold-start wake-up.
            setPdfLoaderStatus(Date.now() - _pdfOpenTime > 2500
                ? "Waking up the server…" : "Preparing your report…");
        } else if (_pdfDisplay >= 96) {
            setPdfLoaderStatus("Almost done…");
        } else if (_pdfEtaMs != null) {
            // Count the estimate down between events for a live feel.
            _pdfEtaMs = Math.max(0, _pdfEtaMs - TICK);
            const secs = Math.min(60, Math.max(1, Math.ceil(_pdfEtaMs / 1000)));
            setPdfLoaderStatus("About " + secs + "s remaining");
        }
    }, TICK);
}

function setPdfLoaderStatus(text) {
    if (!_pdfLoaderEl) return;
    const sub = _pdfLoaderEl.querySelector(".sv-pdf-sub");
    if (sub) sub.textContent = text;
}

// Called with REAL progress (0-100) from the backend's streamed events. The bar
// only ever moves forward and eases toward each milestone, and we extrapolate a
// real time-remaining estimate from the pace observed since the first event.
function reportPdfProgress(p) {
    if (typeof p !== "number" || isNaN(p)) return;
    _pdfRealProgress = true;
    const now = Date.now();
    if (!_pdfRealStartTime) { _pdfRealStartTime = now; _pdfRealStartPct = p; }
    _pdfTarget = Math.max(_pdfTarget, Math.min(99, p));
    const elapsed = now - _pdfRealStartTime;
    const gained = p - _pdfRealStartPct;
    if (gained > 0 && elapsed > 250) {
        // remaining = remaining% ÷ observed rate, clamped, then smoothed.
        const remainingMs = Math.min(120000, (100 - p) * elapsed / gained);
        _pdfEtaMs = _pdfEtaMs == null ? remainingMs : (_pdfEtaMs * 0.4 + remainingMs * 0.6);
    }
}

function hidePdfLoader(success) {
    clearInterval(_pdfLoaderTimer);
    if (success) setPdfLoaderPct(100);
    // Only the standalone overlay needs hiding; the inline loader is cleared
    // when the popup closes and restores its original success markup.
    if (_pdfLoaderOverlay) {
        if (success) {
            setTimeout(() => { if (_pdfLoaderOverlay) _pdfLoaderOverlay.style.display = "none"; }, 550);
        } else {
            _pdfLoaderOverlay.style.display = "none";
        }
    }
    _pdfLoaderTarget = null;
}

// Generates the PDF from the current calculator state and downloads it.
async function downloadReportPdf(company) {
    showPdfLoader();
    try {
        const reportData = prepareReportData(company || "");
        // Ask for streamed progress (?stream=1): the server sends newline-
        // delimited JSON — {"progress":N} events then {"success":true,...}.
        const response = await fetch(`${BASE_URL}/generate-pdf?stream=1`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportData }),
        });
        if (!response.ok) throw new Error("Failed to generate PDF");

        let result = null;
        if (response.body && response.body.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf("\n")) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line) continue;
                    let msg;
                    try { msg = JSON.parse(line); } catch (e) { continue; }
                    if (typeof msg.progress === "number") reportPdfProgress(msg.progress);
                    if (msg.success === false) throw new Error(msg.message || "Failed to generate PDF");
                    if (msg.success === true) result = msg;
                }
            }
            const tail = buf.trim();
            if (!result && tail) { try { const m = JSON.parse(tail); if (m.success) result = m; } catch (e) {} }
        } else {
            // No streaming support in this browser — parse as one JSON response.
            result = await response.json();
        }

        if (!result || !result.success || !result.pdfBase64) {
            throw new Error((result && result.message) || "Failed to generate PDF");
        }
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `SAFE_Calculator_Report_${new Date().toISOString().split("T")[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        hidePdfLoader(true);
        showToast("Report downloaded!", "success");
    } catch (e) {
        console.error("Download error:", e);
        hidePdfLoader(false);
        showToast(e.message || "Error generating report", "error");
    }
}
window.downloadReportPdf = downloadReportPdf;

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast-notification ${type}`;
    toast.style.display = 'block';

    setTimeout(() => {
        toast.style.display = 'none';
    }, 4000);
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}


const prepareReportData = (companyName) => {
    const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    // Summary values (ownership, dilution, post-money, PPS, total shares) are
    // computed directly from `pricedConversion` / `pricedTable` below — see the
    // "Summary values" block after the cap tables are built. This guarantees the
    // PDF summary always agrees with the freshly-recomputed rows, rather than
    // reading possibly-stale formatted strings out of the live DOM.

    const seriesInvestmentOnlyVal = state.rowData
        .filter(r => r.type === CapTableRowType.Series)
        .reduce((sum, r) => sum + (r.investment || 0), 0);
    const totalSeriesRaised = formatUSDWithCommas(seriesInvestmentOnlyVal);

    // =========================================================================
    // SNAPSHOT 2: PRE-ROUND (Post-SAFE)
    // =========================================================================
    const preRound = buildEstimatedPreRoundCapTable(state.rowData);

    // =========================================================================
    // SNAPSHOT 3: POST-ROUND
    // =========================================================================
    const rawSafes = state.rowData.filter(r => r.type === CapTableRowType.Safe);
    const populatedSafes = populateSafeCaps(rawSafes);
    const seriesInvs = state.rowData
        .filter(r => r.type === CapTableRowType.Series)
        .map(r => r.investment);

    const unusedOptionsValue = state.rowData.find(r => r.id === "UnusedOptionsPool")?.shares || 0;
    const commonSharesOnly = state.rowData.filter(r => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool").reduce((sum, r) => sum + r.shares, 0);

    const pricedConversion = fitConversion(
        state.preMoney,
        commonSharesOnly,
        populatedSafes,
        unusedOptionsValue,
        state.targetOptionsPool,
        seriesInvs
    );

    const pricedTable = buildPricedRoundCapTable(pricedConversion, state.rowData);

    // Synchronize SAFE shares between Pre and Post (same as updateUI)
    // Without this sync, pre-round values in the PDF would differ from the UI
    preRound.safes = preRound.safes.map(preSafe => {
        const postSafe = pricedTable.safes.find(ps => ps.id === preSafe.id);
        return postSafe ? { ...preSafe, shares: postSafe.shares } : preSafe;
    });
    preRound.total.shares = preRound.common.reduce((a, c) => a + (c.shares || 0), 0) +
                            preRound.safes.reduce((a, s) => a + (s.shares || 0), 0);
    preRound.common.forEach(c => c.ownershipPct = c.shares / preRound.total.shares);
    preRound.safes.forEach(s => s.ownershipPct = s.shares / preRound.total.shares);

    const commonSharesTotalPre = preRound.total.shares;
    const founderSharesPre = preRound.common
        .filter((c) => c.category === "Founder")
        .reduce((a, c) => a + c.shares, 0);
    const totalFounderPctPre = commonSharesTotalPre > 0 ? founderSharesPre / commonSharesTotalPre : 0;

    // =========================================================================
    // Summary values — computed from the same pricedConversion/pricedTable used
    // for the rows, so the PDF summary can never drift from the table or the UI.
    // Mirrors exactly what updateUI() writes into the on-screen result panel.
    // =========================================================================
    const foundersPost = pricedTable.common.filter((c) => c.category === "Founder");
    const totalFounderPctPost = foundersPost.reduce((a, f) => a + (f.ownershipPct || 0), 0);
    const dilutionPost = totalFounderPctPre > 0 ? totalFounderPctPre - totalFounderPctPost : NaN;
    const postMoneyVal = pricedConversion.totalShares * pricedConversion.pps;

    const founderOwnership = safeFormatPercent(totalFounderPctPost);
    const founderDilution = safeFormatPercent(dilutionPost);
    const postMoney = safeFormatCurrency(postMoneyVal);
    const pricePerShareVal = safeFormatPPS(pricedConversion.pps);
    const totalSharesVal = safeFormatNumber(pricedTable.total.shares);

    // Reuse the insight generator for the API summary_text
    const summariesArray = generateSummaryText(preRound, pricedTable, pricedConversion, state, totalFounderPctPre);
    const plainTextSummary = summariesArray.join(' ');

    const commonCatTotals = {};
    pricedTable.common.forEach(r => { const c = r.category || 'Other'; commonCatTotals[c] = (commonCatTotals[c] || 0) + 1; });
    const commonCatCounts = {};

    const rows = [
        ...pricedTable.common.map(r => {
            const cat = r.category || 'Other';
            commonCatCounts[cat] = (commonCatCounts[cat] || 0) + 1;
            const autoName = commonCatTotals[cat] > 1 ? `${cat} ${commonCatCounts[cat]}` : cat;
            return {
            name: (r.name && r.name.trim()) ? r.name.trim() : autoName,
            preShares: preRound.common.find(pr => pr.id === r.id)?.shares || r.shares,
            postShares: r.shares,
            badge: null,
            isFounder: r.category === "Founder",
            isSafe: false,
            isInvestor: false,
            pps: r.shares > 0 ? safeFormatPPS(r.pps) : "—"
        }}),
        ...pricedTable.safes.map(r => {
            let badge = null;
            let badgeStyle = "";
            const safeMatch = populatedSafes.find(s => s.id === r.id);

            if (isMFN(r)) {
                badge = "MFN SAFE";
                badgeStyle = "border-[#fecaca] bg-[#fee2e2] text-[#991b1b]";
            } else if (r.conversionType === "pre") {
                badge = "Pre-money SAFE";
                badgeStyle = "border-[#fde68a] bg-[#fef3c7] text-[#92400e]";
            } else if (r.conversionType === "post") {
                badge = "Post-money SAFE";
                badgeStyle = "border-[#a7f3d0] bg-[#d1fae5] text-[#065f46]";
            }

            return {
                name: r.name,
                preShares: preRound.safes.find(ps => ps.id === r.id)?.shares || 0,
                postShares: r.shares,
                badge: badge,
                badgeStyle: badgeStyle,
                isFounder: false,
                isSafe: true,
                isInvestor: false,
                investment: r.investment,
                cap: safeMatch?.cap || 0,
                discount: r.discount ? (r.discount * 100).toFixed(0) + "%" : "None",
                type: r.conversionType === "mfn" ? "MFN-money" : (r.conversionType ? r.conversionType.charAt(0).toUpperCase() + r.conversionType.slice(1) + "-money" : "N/A"),
                pps: r.shares > 0 ? safeFormatPPS(r.pps) : "—"
            };
        }),
        ...pricedTable.series.map(r => ({
            name: r.name,
            preShares: 0,
            postShares: r.shares,
            badge: null,
            badgeStyle: "",
            isFounder: false,
            isSafe: false,
            isInvestor: true,
            investment: r.investment,
            pps: r.shares > 0 ? safeFormatPPS(r.pps) : "—"
        }))
    ];

    if (pricedTable.refreshedOptionsPool && pricedTable.refreshedOptionsPool.shares > 0) {
        const preOptions = unusedOptionsValue;
        const postOptions = pricedTable.refreshedOptionsPool.shares;

        let badge = null;
        let badgeStyle = "";

        if (postOptions > preOptions + 1) {
            badge = "Pool top-up";
            badgeStyle = "border-[#c7d2fe] bg-[#e0e7ff] text-[#3730a3]";
        }

        const esopRow = state.rowData?.find(r => r.id === "UnusedOptionsPool");
        const esopName = esopRow?.name || "Option Pool";
        rows.push({
            name: esopName,
            preShares: preOptions,
            postShares: postOptions,
            badge: badge || "ESOP",
            badgeStyle: badgeStyle,
            isFounder: false,
            isSafe: false,
            isInvestor: false,
            pps: "—"
        });
    }

    const ownershipPre = safeFormatPercent(totalFounderPctPre);

    const optionPoolDisplay = state.targetOptionsPool + "%";

    return {
        companyName: companyName || "My Company",
        valuation: state.preMoney,
        raised: pricedConversion.totalSeriesInvestment,
        roundName: state.roundName || "priced round",
        timestamp: timestamp,
        optionPool: optionPoolDisplay,
        safeAmount: state.rowData.filter(r => r.type === CapTableRowType.Safe).reduce((sum, r) => sum + (r.investment || 0), 0),
        summary_text: plainTextSummary.trim(), // Added for the backend to use as the primary summary
        summary: {
            ownershipPre: ownershipPre,
            ownershipPost: founderOwnership,
            dilution: founderDilution,
            postMoney: postMoney,
            pricePerShare: pricePerShareVal,
            totalShares: totalSharesVal,
            totalRaised: totalSeriesRaised
        },
        rows: rows
    };
};

// ── Download lead-capture flow (no email sending) ──
window.showEmailModal = function() {
    // Prefer the native Webflow form as a popup → captures the lead in Webflow,
    // then downloads the PDF on success. Falls back to the built-in modal when
    // the Webflow form isn't on the page (e.g. standalone/local use).
    const opened = openWebflowLeadPopup(() => {
        const wrap = getWebflowWrap();
        const companyEl = wrap && wrap.querySelector('[name="Company"]');
        return downloadReportPdf(companyEl ? companyEl.value.trim() : "");
    });
    if (opened) return;

    const modal = document.getElementById('email-modal');
    if (!modal) return;

    const errorSpan = document.getElementById('email-error');
    if (errorSpan) errorSpan.style.display = 'none';

    modal.style.display = 'flex';

    const firstNameInput = document.getElementById('first-name-input');
    const firstEmailInput = document.querySelector('.email-recipient-input');
    setTimeout(() => {
        if (firstNameInput) firstNameInput.focus();
        else if (firstEmailInput) firstEmailInput.focus();
    }, 100);
};

window.hideEmailModal = function() {
    const modal = document.getElementById('email-modal');
    if (modal) modal.style.display = 'none';
};

window.submitDownloadForm = async function() {
    const firstNameInput = document.getElementById('first-name-input');
    const lastNameInput = document.getElementById('last-name-input');
    const companyInput = document.getElementById('company-input');
    const newsletterCheckbox = document.getElementById('newsletter-checkbox');
    const emailInput = document.querySelector('.email-recipient-input');
    const errorSpan = document.getElementById('email-error');
    const sendBtn = document.getElementById('send-email-btn');
    const btnText = document.getElementById('send-btn-text');
    const btnLoader = document.getElementById('send-btn-loader');

    const firstName = firstNameInput ? firstNameInput.value.trim() : '';
    const lastName = lastNameInput ? lastNameInput.value.trim() : '';
    const company = companyInput ? companyInput.value.trim() : '';
    const subscribe = newsletterCheckbox ? newsletterCheckbox.checked : false;
    const email = emailInput ? emailInput.value.trim() : '';

    // Reset validation styles
    if (firstNameInput) firstNameInput.style.borderColor = '';
    if (emailInput) emailInput.style.borderColor = '';
    errorSpan.style.display = 'none';

    let hasError = false;
    if (!firstName) {
        if (firstNameInput) firstNameInput.style.borderColor = '#ef4444';
        hasError = true;
    }
    if (!email) {
        if (emailInput) emailInput.style.borderColor = '#ef4444';
        errorSpan.textContent = 'Please enter your work email';
        errorSpan.style.display = 'block';
        hasError = true;
    } else if (!validateEmail(email)) {
        if (emailInput) emailInput.style.borderColor = '#ef4444';
        errorSpan.textContent = `"${email}" is not a valid email address`;
        errorSpan.style.display = 'block';
        hasError = true;
    }
    if (hasError) {
        if (!errorSpan.textContent) {
            errorSpan.textContent = 'Please fill in all required fields';
            errorSpan.style.display = 'block';
        }
        return;
    }

    sendBtn.disabled = true;
    const originalBtnText = btnText.textContent;
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-flex';
    if (btnLoader.querySelector('span')) {
        btnLoader.querySelector('span').textContent = 'Generating...';
    }

    try {
        const reportData = prepareReportData(company);

        // The backend only generates the PDF — it no longer stores leads.
        const response = await fetch(`${BASE_URL}/generate-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reportData: reportData })
        });

        if (!response.ok) throw new Error('Failed to generate PDF');
        const result = await response.json();

        if (result.success) {
            const byteCharacters = atob(result.pdfBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `SAFE_Calculator_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Report downloaded!', 'success');
            hideEmailModal();
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error('Download Error:', error);
        showToast(error.message || 'Error communicating with API', 'error');
    } finally {
        sendBtn.disabled = false;
        btnText.style.display = 'inline';
        btnText.textContent = originalBtnText;
        btnLoader.style.display = 'none';
    }
};

document.addEventListener('click', function(event) {
    const modal = document.getElementById('email-modal');
    if (event.target === modal) {
        hideEmailModal();
    }
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const modal = document.getElementById('email-modal');
        if (modal && modal.style.display === 'flex') {
            hideEmailModal();
        }
    }
});




      // Initialize the UI after scripts are loaded
      window.addEventListener("DOMContentLoaded", () => {
        if (typeof updateUI === "function") {
          updateUI();
        }
      });
    


      function syncResultsPanelHeight() {
        const rightPanel = document.getElementById('results-panel');
        if (!rightPanel) return;

        // Find the visible left section
        const sectionIds = ['cap-table-section', 'safes-section', 'priced-round-section'];
        let visibleSection = null;
        for (const id of sectionIds) {
          const el = document.getElementById(id);
          if (el && el.style.display !== 'none') { visibleSection = el; break; }
        }
        if (!visibleSection) return;

        // Bottom of left card (absolute page position)
        const leftBottom = visibleSection.getBoundingClientRect().bottom + window.scrollY;
        // Top of results panel (absolute page position)
        const panelTop = rightPanel.getBoundingClientRect().top + window.scrollY;

        const desiredHeight = leftBottom - panelTop;

        // Cap at viewport height so it never overflows the screen
        const navEl = document.querySelector('nav.nav');
        const navH = navEl ? navEl.offsetHeight : 60;
        const vpCap = window.innerHeight - navH - 24;

        rightPanel.style.height = Math.min(desiredHeight, vpCap) + 'px';
        rightPanel.style.maxHeight = '';
      }

      window.addEventListener('resize', syncResultsPanelHeight);
      window.addEventListener('scroll', syncResultsPanelHeight, { passive: true });
      window.addEventListener('DOMContentLoaded', () => {
        const baseGoToStep = window.goToStep;
        if (baseGoToStep) {
          window.goToStep = function(...args) {
            const result = baseGoToStep.apply(this, args);
            requestAnimationFrame(syncResultsPanelHeight);
            return result;
          };
        }
        const baseUpdateUI = window.updateUI;
        if (baseUpdateUI) {
          window.updateUI = function(...args) {
            const result = baseUpdateUI.apply(this, args);
            requestAnimationFrame(syncResultsPanelHeight);
            return result;
          };
        }
        const leftCol = document.querySelector('.calculator-column');
        if (leftCol) {
          new MutationObserver(() => requestAnimationFrame(syncResultsPanelHeight))
            .observe(leftCol, { childList: true, subtree: true });
        }
        requestAnimationFrame(syncResultsPanelHeight);
      });
    