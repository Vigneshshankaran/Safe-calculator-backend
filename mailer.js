const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

// Domain from address - can be "onboarding@resend.dev" for testing
// or a verified domain like "no-reply@equitylist.co"
const FROM_EMAIL = "onboarding@resend.dev"; 

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
                console.warn('[Mailer] leads.json was invalid, resetting.');
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

    const studentName = summaryData?.firstName 
        ? summaryData.firstName.charAt(0).toUpperCase() + summaryData.firstName.slice(1) 
        : 'User';

    // HTML Template
    const htmlContent = `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #1e293b; padding: 20px;">
            <h2 style="color: #0f172a;">Hi ${studentName},</h2>
            <p>Thank you for using the EquityList SAFE Calculator. Please find your detailed report attached below.</p>
            
            <div style="background: #f8fafc; padding: 24px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0;">
                <h3 style="margin-top: 0; font-size: 16px; color: #64748b;">Report Summary</h3>
                <p style="margin: 8px 0;"><strong>Founder Ownership:</strong> ${summaryData?.founderOwnership || 'N/A'}</p>
                <p style="margin: 8px 0;"><strong>Post-Money Valuation:</strong> ${summaryData?.postMoney || 'N/A'}</p>
                <p style="margin: 8px 0;"><strong>Total Raised:</strong> ${summaryData?.totalRaised || 'N/A'}</p>
            </div>

            <p>If you have any questions or need a detailed equity consultation, we're here to help.</p>
            <p>Best regards,<br><strong>The EquityList Team</strong></p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
            <p style="font-size: 12px; color: #94a3b8; font-style: italic;">
                Note: This report is based on the data entered in the calculator. Final outcomes may vary based on legal documentation and definitive agreements.
            </p>
        </div>
    `;

    try {
        const result = await resend.emails.send({
            from: `EquityList <${FROM_EMAIL}>`,
            to: Array.isArray(to_email) ? to_email : [to_email],
            subject: 'Your SAFE Calculator Equity Results',
            html: htmlContent,
            attachments: [
                {
                    filename: `SAFE_Equity_Report_${Date.now()}.pdf`,
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