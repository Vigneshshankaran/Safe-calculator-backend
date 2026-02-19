const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

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
        console.log(`[Mailer] Lead recorded: ${email}`);
    } catch (err) {
        console.error('[Mailer] Lead save failed:', err.message);
    }
}

/**
 * Handles the generation and dispatch of the PDF report via email.
 */
async function sendPDFReport(to_email, pdfBase64, summaryData) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        throw new Error('Missing SMTP credentials.');
    }

    const recipient = Array.isArray(to_email) ? to_email[0] : to_email;
    saveLead(recipient, summaryData);

    // Create transporter with explicit SSL settings for cloud resilience
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // Use SSL/TLS
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS // Must be a 16-character App Password
        },
        // Optimize for containerized network latency
        connectionTimeout: 15000, 
        greetingTimeout: 15000,
        socketTimeout: 30000,
    });

    const studentName = summaryData?.firstName || 'User';

    const mailOptions = {
        from: `"EquityList SAFE Calculator" <${process.env.GMAIL_USER}>`,
        to: to_email,
        subject: 'Your EquityList SAFE Calculator Results',
        html: `
            <div style="font-family: sans-serif; max-width: 600px; line-height: 1.6; color: #334155;">
                <h2>Hi ${studentName},</h2>
                <p>Thank you for using our SAFE Calculator. Please find your detailed report attached.</p>
                
                <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Founder Ownership:</strong> ${summaryData?.founderOwnership || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Post-Money Valuation:</strong> ${summaryData?.postMoney || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Total Raised:</strong> ${summaryData?.totalRaised || 'N/A'}</p>
                </div>

                <p>If you have any questions about these results, feel free to reply to this email.</p>
                <p>Best regards,<br>The EquityList Team</p>
            </div>
        `,
        attachments: [
            {
                filename: `SAFE_Equity_Report_${Date.now()}.pdf`,
                content: pdfBase64,
                encoding: 'base64'
            }
        ]
    };

    console.log(`[SMTP] Attempting delivery to: ${recipient} via Port 465...`);
    
    // Attempt delivery directly without .verify() to optimize for high-latency networks
    const info = await transporter.sendMail(mailOptions);
    console.log(`[SMTP] Successfully delivered! Message ID: ${info.messageId}`);
    return info;
}

module.exports = { sendPDFReport, saveLead };
