import axios from 'axios';
import path from 'path';
import fs from 'fs';

/**
 * Generate Certificate Format 1 (Professional Achievement)
 * Pure code-based design for high resolution and professional look
 */
export const generateFormat1 = async (doc, { user, course, progress, settings, certificateData }) => {
    try {
        const primaryColor = settings?.theme?.primaryColor || '#C40C0C';
        const siteName = settings?.general?.siteName || 'God of Graphics';
        const accentColor = '#D4AF37'; // Gold
        
        const width = doc.page.width;
        const height = doc.page.height;

        // 1. Draw Background & Borders
        doc.rect(0, 0, width, height).fill('#ffffff');
        
        // Main Border (Navy/Primary)
        doc.rect(20, 20, width - 40, height - 40).lineWidth(8).stroke(primaryColor);
        
        // Inner Decorative Border (Gold)
        doc.rect(35, 35, width - 70, height - 70).lineWidth(2).stroke(accentColor);

        // Corner Accents
        const accentSize = 60;
        doc.lineWidth(15).strokeColor(primaryColor);
        // Top Left
        doc.moveTo(20, 20 + accentSize).lineTo(20, 20).lineTo(20 + accentSize, 20).stroke();
        // Top Right
        doc.moveTo(width - 20 - accentSize, 20).lineTo(width - 20, 20).lineTo(width - 20, 20 + accentSize).stroke();
        // Bottom Left
        doc.moveTo(20, height - 20 - accentSize).lineTo(20, height - 20).lineTo(20 + accentSize, height - 20).stroke();
        // Bottom Right
        doc.moveTo(width - 20 - accentSize, height - 20).lineTo(width - 20, height - 20).lineTo(width - 20, height - 20 - accentSize).stroke();

        // 2. Add Logo
        const logoToUse = settings?.general?.pdfLogo || settings?.general?.siteLogo;
        if (logoToUse) {
            try {
                if (logoToUse.startsWith('data:image')) {
                    const base64Data = logoToUse.replace(/^data:image\/\w+;base64,/, "");
                    const logoBuffer = Buffer.from(base64Data, 'base64');
                    doc.image(logoBuffer, (width / 2) - 40, 60, { height: 60 });
                } else if (logoToUse.startsWith('http')) {
                    const response = await axios.get(logoToUse, { responseType: 'arraybuffer' });
                    doc.image(Buffer.from(response.data, 'binary'), (width / 2) - 40, 60, { height: 60 });
                } else {
                    const logoPath = path.join(process.cwd(), logoToUse.startsWith('/') ? logoToUse : '/' + logoToUse);
                    if (fs.existsSync(logoPath)) doc.image(logoPath, (width / 2) - 40, 60, { height: 60 });
                }
            } catch (e) {}
        }

        // 3. Header Text
        doc.font('Helvetica-Bold')
           .fontSize(45)
           .fillColor(primaryColor)
           .text('CERTIFICATE', 0, 110, { align: 'center', width: width });
        
        doc.fontSize(18)
           .fillColor('#555555')
           .text('OF ACHIEVEMENT', 0, 160, { align: 'center', width: width, characterSpacing: 5 });

        // 3.1 Top Information (Absolute Corners)
        const topInfoY = 55;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#888888');
        doc.text(`ROLL NO: ${user.rollNumber || 'GOG-S-' + user._id.toString().slice(-5).toUpperCase()}`, 50, topInfoY, { align: 'left' });
        doc.text(`ISSUE DATE: ${new Date().toLocaleDateString('en-GB')}`, width - 190, topInfoY, { align: 'right', width: 140 });

        // 4. Main Body
        doc.font('Times-Italic')
           .fontSize(22)
           .fillColor('#333333')
           .text('This is to certify that', 0, 220, { align: 'center', width: width });

        // Student Name
        doc.font('Helvetica-Bold')
           .fontSize(40)
           .fillColor(primaryColor)
           .text(user.name.toUpperCase(), 0, 260, { align: 'center', width: width });

        // Decorative Line under Name
        doc.moveTo((width / 2) - 200, 310).lineTo((width / 2) + 200, 310).lineWidth(1).stroke(accentColor);

        doc.font('Helvetica')
           .fontSize(16)
           .fillColor('#555555')
           .text('has successfully completed the professional course in', 0, 330, { align: 'center', width: width });

        // Course Name
        doc.font('Helvetica-Bold')
           .fontSize(28)
           .fillColor('#1a1a1a')
           .text(course.title.toUpperCase(), 0, 360, { align: 'center', width: width });

        // 5. Achievement Metrics Box (Refactored)
        const progressVal = progress?.progressPercent || 100;
        let division = 'PASSED';
        if (progressVal >= 75) division = 'DISTINCTION (A+)';
        else if (progressVal >= 60) division = 'FIRST DIVISION (A)';
        else if (progressVal >= 50) division = 'SECOND DIVISION (B)';
        
        const boxY = 430;
        const boxWidth = 500;
        const startX = (width - boxWidth) / 2;
        
        doc.rect(startX, boxY, boxWidth, 60).fill('#fcfcfc').stroke('#dddddd');
        
        const colW = boxWidth / 3;
        
        const addStat = (label, value, x) => {
            doc.font('Helvetica').fontSize(9).fillColor('#888888').text(label, x, boxY + 15, { width: colW, align: 'center' });
            doc.font('Helvetica-Bold').fontSize(12).fillColor(primaryColor).text(value, x, boxY + 30, { width: colW, align: 'center' });
        };

        addStat('FINAL SCORE', `${progressVal}%`, startX);
        addStat('ACADEMIC DIVISION', division, startX + colW);
        addStat('STATUS', 'VERIFIED', startX + (colW * 2));

        // 6. Seal & Signatures
        const footerY = height - 120;
        const footerLineY = height - 80;
        
        // ── LEFT SIDE: Official Stamp ──────────────────────────────────────────
        const stampX = 100;
        const sealToUse = settings?.general?.pdfCertificateSeal;
        
        if (sealToUse) {
            try {
                if (sealToUse.startsWith('data:image')) {
                    const buffer = Buffer.from(sealToUse.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                    doc.image(buffer, stampX + 35, footerY - 50, { height: 80 });
                } else if (sealToUse.startsWith('http')) {
                    const response = await axios.get(sealToUse, { responseType: 'arraybuffer' });
                    doc.image(Buffer.from(response.data, 'binary'), stampX + 35, footerY - 50, { height: 80 });
                } else {
                    const sealPath = path.join(process.cwd(), sealToUse.startsWith('/') ? sealToUse : '/' + sealToUse);
                    if (fs.existsSync(sealPath)) doc.image(sealPath, stampX + 35, footerY - 50, { height: 80 });
                }
            } catch (e) {
                // Fallback seal
                doc.circle(stampX + 75, footerY - 10, 35).lineWidth(2).stroke(accentColor);
                doc.font('Helvetica-Bold').fontSize(10).fillColor(accentColor).text('CERTIFIED', stampX + 45, footerY - 15, { width: 60, align: 'center' });
            }
        } else {
            doc.circle(stampX + 75, footerY - 10, 35).lineWidth(2).stroke(accentColor);
            doc.font('Helvetica-Bold').fontSize(10).fillColor(accentColor).text('CERTIFIED', stampX + 45, footerY - 15, { width: 60, align: 'center' });
        }

        // Stamp Label
        doc.moveTo(stampX, footerLineY).lineTo(stampX + 150, footerLineY).lineWidth(1).stroke('#333');
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333').text('OFFICIAL STAMP', stampX, footerLineY + 10, { width: 150, align: 'center' });

        // ── RIGHT SIDE: Authorized Signature ──────────────────────────────────
        const signX = width - 250;
        const signatureToUse = settings?.general?.pdfCertificateSignature;

        if (signatureToUse) {
            try {
                if (signatureToUse.startsWith('data:image')) {
                    const buffer = Buffer.from(signatureToUse.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                    doc.image(buffer, signX, footerY - 40, { width: 150 });
                } else if (signatureToUse.startsWith('http')) {
                    const response = await axios.get(signatureToUse, { responseType: 'arraybuffer' });
                    doc.image(Buffer.from(response.data, 'binary'), signX, footerY - 40, { width: 150 });
                } else {
                    const signPath = path.join(process.cwd(), signatureToUse.startsWith('/') ? signatureToUse : '/' + signatureToUse);
                    if (fs.existsSync(signPath)) doc.image(signPath, signX, footerY - 40, { width: 150 });
                }
            } catch (e) {
                doc.font('Times-Italic').fontSize(18).fillColor('#1a1a1a').text(settings?.general?.adminName || 'Authorized Signatory', signX, footerY - 15, { width: 150, align: 'center' });
            }
        } else {
            doc.font('Times-Italic').fontSize(18).fillColor('#1a1a1a').text(settings?.general?.adminName || 'Authorized Signatory', signX, footerY - 15, { width: 150, align: 'center' });
        }

        // Signature Line & Admin Name
        doc.moveTo(signX, footerLineY).lineTo(signX + 150, footerLineY).lineWidth(1).stroke('#333');
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333').text(settings?.general?.adminName?.toUpperCase() || 'DIRECTOR', signX, footerLineY + 10, { width: 150, align: 'center' });
        doc.font('Helvetica').fontSize(8).fillColor('#666').text('AUTHORIZED SIGNATORY', signX, footerLineY + 22, { width: 150, align: 'center' });

        // 7. Verification PIN (Clean Footer)
        const footerBottom = height - 40;
        doc.font('Helvetica').fontSize(8).fillColor('#aaaaaa')
           .text(`Verification ID: ${certificateData?.certificateId || 'CERT-' + Date.now().toString().slice(-8).toUpperCase()}`, 0, footerBottom, { align: 'center', width: width });

    } catch (error) {
        console.error('Error generating Certificate Format 1:', error);
        throw error;
    }
};
