const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

// Domain from address - must be verified in Resend dashboard
const FROM_EMAIL = "no-reply@equitylist.co"; 

/**
 * Persists lead information to a local file.
 */
function saveLead(email, data = {}) {
    try {
        const lead = {
            timestamp: new Date().toISOString(),
            firstName: data.firstName || "Unknown",
            lastName: data.lastName || "",
            email: email,
            company: data.companyName || "",
            newsletter: data.subscribe || false
        };

        const filePath = path.join(__dirname, 'leads.json');
        let leads = [];

        if (fs.existsSync(filePath)) {
            try {
                leads = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) {
                console.warn('[Resend] leads.json was invalid, resetting.');
            }
        }

        leads.push(lead);
        fs.writeFileSync(filePath, JSON.stringify(leads, null, 2));
        console.log(`[Resend] Lead recorded: ${email}`);
    } catch (err) {
        console.error('[Resend] Lead save failed:', err.message);
    }
}

/**
 * Sends a PDF report via Resend API (HTTPS).
 * Bypasses SMTP port restrictions on Railway free tier.
 */
async function sendPDFReport(to_email, pdfBase64, summaryData) {
    if (!process.env.RESEND_API_KEY) {
        throw new Error('Missing RESEND_API_KEY in environment variables.');
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const recipient = Array.isArray(to_email) ? to_email[0] : to_email;
    
    // Log intent
    console.log(`[Resend] Preparing email delivery to: ${recipient}`);

    // Persist lead
    saveLead(recipient, summaryData);

    const firstName = summaryData.firstName 
        ? summaryData.firstName.charAt(0).toUpperCase() + summaryData.firstName.slice(1) 
        : 'there';

    // User-provided HTML Template
    const htmlContent = `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hi ${firstName},</p>
            <p>Thank you for using EquityList’s SAFE Calculator.</p>
            <p>Here’s a quick summary of the outcome you modeled:</p>
            <div style="background: #f8fafc; padding: 24px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Founder ownership post-round</td>
                        <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.founderOwnership || 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total founder dilution</td>
                        <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.founderDilution || 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Post-money valuation</td>
                        <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.postMoney || 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total raised (SAFEs + priced round)</td>
                        <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.totalRaised || 'N/A'}</td>
                    </tr>
                </table>
            </div>
            <p>We’ve attached the full calculation, including the post-round cap table, SAFE conversion, option pool impact, and investor ownership.</p>
            <br>
            <p style="margin-bottom: 4px;">Best,</p>
            <p style="margin-top: 0;"><strong>Farheen, EquityList</strong><br><a href="https://equitylist.co" style= "text-decoration: none; font-weight: 600;">(Book a demo)</a></p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 40px 0;">
            <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; font-style: italic;">
                Note: This is a modeled outcome based on the assumptions you entered. Final results may vary based on documentation and execution.
            </p>
        </div>
    `;

    try {
        const result = await resend.emails.send({
            from: `EquityList SAFE Calculator <${FROM_EMAIL}>`,
            to: Array.isArray(to_email) ? to_email : [to_email],
            subject: `Your SAFE calculator results | EquityList`,
            html: htmlContent,
            attachments: [
                {
                    filename: `SAFE_Equity_Report_${new Date().toISOString().split('T')[0]}.pdf`,
                    content: Buffer.from(pdfBase64, 'base64'),
                }
            ]
        });

        if (result.error) {
            console.error('[Resend] API Error:', result.error.message);
            throw new Error(result.error.message);
        }

        console.log(`[Resend] Delivery successful! ID: ${result.data.id}`);
        return result.data;
    } catch (apiError) {
        console.error('[Resend] Critical failure:', apiError.message);
        throw apiError;
    }
}

module.exports = { sendPDFReport, saveLead };