const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/**
 * Saves lead info to a local leads.json file.
 */
function saveLead(to_email, summaryData) {
    try {
        const data = summaryData || {};
        const lead = {
            timestamp: new Date().toISOString(),
            firstName: data.firstName || "Unknown",
            lastName: data.lastName || "",
            email: to_email,
            company: data.companyName || "",
            newsletter: data.subscribe || false
        };
        const leadsPath = path.join(__dirname, 'leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
            const content = fs.readFileSync(leadsPath, 'utf8');
            try {
                leads = JSON.parse(content);
            } catch (e) {
                leads = [];
            }
        }
        leads.push(lead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));
        console.log('Lead saved to leads.json');
    } catch (err) {
        console.error('Failed to save lead:', err);
    }
}

/**
 * Sends a high-quality PDF report via Gmail SMTP using Nodemailer.
 */
async function sendPDFReport(to_email, pdfBase64, summaryData) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        throw new Error('GMAIL_USER or GMAIL_PASS is not defined in the .env file.');
    }

    // Save lead automatically on email (use primary email if multiple provided)
    const primaryEmail = Array.isArray(to_email) ? to_email[0] : to_email;
    saveLead(primaryEmail, summaryData);

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // Use STARTTLS
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        },
        connectionTimeout: 20000, // 20 seconds
        greetingTimeout: 20000,
        socketTimeout: 30000
    });

    const data = summaryData || {};
    const firstName = data.firstName 
        ? data.firstName.charAt(0).toUpperCase() + data.firstName.slice(1) 
        : 'there';

    const mailOptions = {
        from: { name: "EquityList SAFE Calculator", address: process.env.GMAIL_USER },
        to: [to_email],
        subject: `Your SAFE calculator results | EquityList`,
        html: `
            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; color: #1e293b; line-height: 1.6;">
                <p>Hi ${firstName},</p>
                <p>Thank you for using EquityList’s SAFE Calculator.</p>
                <p>Here’s a quick summary of the outcome you modeled:</p>
                <div style="background: #f8fafc; padding: 24px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Founder ownership post-round</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.founderOwnership}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total founder dilution</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.founderDilution}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Post-money valuation</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.postMoney}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Total raised (SAFEs + priced round)</td>
                            <td style="padding: 8px 0; text-align: right; color: #1e293b; font-weight: 600; font-size: 14px;">${summaryData.totalRaised}</td>
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

    console.log(`[SMTP] Attempting to connect to ${mailOptions.host || 'smtp.gmail.com'} on port ${mailOptions.port || 587}...`);
    
    try {
        await transporter.verify();
        console.log('[SMTP] Connection verified successfully.');
    } catch (verifyError) {
        console.error('[SMTP] Verification FAILED:', verifyError.message);
        throw verifyError;
    }

    console.log(`[SMTP] Sending email to ${to_email}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`[SMTP] Email sent! MessageId: ${info.messageId}`);
    return info;
}

module.exports = { sendPDFReport, saveLead };

