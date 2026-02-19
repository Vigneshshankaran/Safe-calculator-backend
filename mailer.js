const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/**
 * Saves lead information to a local JSON file for persistence.
 * @param {string} email - Recipient email.
 * @param {Object} summaryData - Data collected from the frontend.
 */
function saveLead(email, summaryData) {
    try {
        const data = summaryData || {};
        const lead = {
            timestamp: new Date().toISOString(),
            firstName: data.firstName || "Unknown",
            lastName: data.lastName || "",
            email: email,
            company: data.companyName || "",
            newsletter: data.subscribe || false
        };

        const leadsPath = path.join(__dirname, 'leads.json');
        let leads = [];

        if (fs.existsSync(leadsPath)) {
            try {
                const content = fs.readFileSync(leadsPath, 'utf8');
                leads = JSON.parse(content);
            } catch (parseError) {
                console.warn('[Mailer] Could not parse leads.json, starting fresh.');
                leads = [];
            }
        }

        leads.push(lead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));
        console.log(`[Lead] Recorded entry for: ${email}`);
    } catch (err) {
        console.error('[Lead] Error saving to leads.json:', err.message);
    }
}

/**
 * Sends a high-quality PDF report via Gmail SMTP.
 * 
 * @param {string|string[]} to_email - Recipient email address(es).
 * @param {string} pdfBase64 - Base64 encoded PDF content.
 * @param {Object} summaryData - Data for the email template.
 */
async function sendPDFReport(to_email, pdfBase64, summaryData) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        throw new Error('GMAIL_USER or GMAIL_PASS missing from environment variables.');
    }

    const primaryEmail = Array.isArray(to_email) ? to_email[0] : to_email;
    saveLead(primaryEmail, summaryData);

    // Optimized for cloud environments (Railway)
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // Port 465 with SSL is typically more robust in data centers
        pool: true,
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        },
        connectionTimeout: 30000, 
        greetingTimeout: 30000,
        socketTimeout: 60000, // Extended for heavy PDF attachments
        tls: {
            rejectUnauthorized: false // Bypasses certain strict proxy/firewall checks
        }
    });

    const data = summaryData || {};
    const firstName = data.firstName 
        ? data.firstName.charAt(0).toUpperCase() + data.firstName.slice(1) 
        : 'there';

    const mailOptions = {
        from: { name: "EquityList SAFE Calculator", address: process.env.GMAIL_USER },
        to: Array.isArray(to_email) ? to_email : [to_email],
        subject: `Your SAFE calculator results | EquityList`,
        html: `
            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; color: #1e293b; line-height: 1.6;">
                <p>Hi ${firstName},</p>
                <p>Thank you for using EquityList’s SAFE Calculator.</p>
                <p>Here’s a quick summary of the outcome you modeled:</p>
                <div style="background: #f8fafc; padding: 24px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Founder ownership post-round</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600;">${data.founderOwnership || 'N/A'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total founder dilution</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600;">${data.founderDilution || 'N/A'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Post-money valuation</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600;">${data.postMoney || 'N/A'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total raised</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600;">${data.totalRaised || 'N/A'}</td>
                        </tr>
                    </table>
                </div>
                <p>We’ve attached the full calculation, including the post-round cap table, SAFE conversion, option pool impact, and investor ownership.</p>
                <br>
                <p style="margin-bottom: 4px;">Best,</p>
                <p style="margin-top: 0;"><strong>Farheen, EquityList</strong><br><a href="https://equitylist.co" style="text-decoration: none; font-weight: 600;">(Book a demo)</a></p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 40px 0;">
                <p style="font-size: 12px; color: #94a3b8; font-style: italic;">
                    Note: This is a modeled outcome based on the assumptions you entered. Final results may vary based on documentation and execution.
                </p>
            </div>
        `,
        attachments: [
            {
                filename: `SAFE_Equity_Report_${new Date().toISOString().split('T')[0]}.pdf`,
                content: pdfBase64,
                encoding: 'base64',
                contentType: 'application/pdf'
            }
        ]
    };

    console.log(`[SMTP] Verifying connection to smtp.gmail.com (Port 465)...`);
    try {
        await transporter.verify();
        console.log('[SMTP] Connection verified.');
    } catch (vError) {
        console.error('[SMTP] Connection FAILED:', vError.message);
        throw vError;
    }

    console.log(`[SMTP] Sending message to ${primaryEmail}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`[SMTP] Success! MessageId: ${info.messageId}`);
    return info;
}

module.exports = { sendPDFReport, saveLead };
