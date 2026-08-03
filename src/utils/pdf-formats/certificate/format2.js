import axios from 'axios';
import path from 'path';
import fs from 'fs';

/**
 * Generate Certificate Format 2 (Modern Blue Training Completion)
 */
export const generateFormat2 = async (doc, { user, course, progress, settings, certificateData }) => {
    try {
        const primaryColor = '#002D5B'; // Deep Blue
        const accentColor = '#3498db'; // Modern Blue
        const width = doc.page.width;
        const height = doc.page.height;

        // 1. Modern Background Design
        doc.rect(0, 0, width, height).fill('#fcfcfc');
        
        // Stylish Side Bar (Left)
        doc.rect(0, 0, 40, height).fill(primaryColor);
        doc.rect(40, 0, 10, height).fill(accentColor);

        // Thin Outer Border
        doc.rect(20, 20, width - 40, height - 40).lineWidth(1).stroke('#dddddd');

        // 2. Add Logo (Top Right)
        const logoToUse = settings?.general?.pdfLogo || settings?.general?.siteLogo;
        if (logoToUse) {
            try {
                if (logoToUse.startsWith('data:image')) {
                    const base64Data = logoToUse.replace(/^data:image\/\w+;base64,/, "");
                    const logoBuffer = Buffer.from(base64Data, 'base64');
                    doc.image(logoBuffer, width - 120, 60, { height: 50 });
                } else if (logoToUse.startsWith('http')) {
                    const response = await axios.get(logoToUse, { responseType: 'arraybuffer' });
                    doc.image(Buffer.from(response.data, 'binary'), width - 120, 60, { height: 50 });
                } else {
                    const logoPath = path.join(process.cwd(), logoToUse.startsWith('/') ? logoToUse : '/' + logoToUse);
                    if (fs.existsSync(logoPath)) doc.image(logoPath, width - 120, 60, { height: 50 });
                }
            } catch (e) {}
        }

        // 3. Header Content
        doc.font('Helvetica-Bold')
           .fontSize(35)
           .fillColor(primaryColor)
           .text('CERTIFICATE OF COMPLETION', 80, 100);

        doc.moveTo(80, 145).lineTo(width - 80, 145).lineWidth(2).stroke(accentColor);

        doc.font('Helvetica')
           .fontSize(16)
           .fillColor('#666666')
           .text('THIS CERTIFICATE IS PROUDLY PRESENTED TO', 80, 180);

        // 4. Student Name
        doc.font('Helvetica-Bold')
           .fontSize(48)
           .fillColor('#1a1a1a')
           .text(user.name.toUpperCase(), 80, 215);

        doc.font('Helvetica')
           .fontSize(16)
           .fillColor('#666666')
           .text('FOR SUCCESSFUL COMPLETION OF INDUSTRIAL TRAINING IN', 80, 285);

        // Course Name
        doc.font('Helvetica-Bold')
           .fontSize(30)
           .fillColor(primaryColor)
           .text(course.title.toUpperCase(), 80, 315);

        // 5. Training Period & Details
        const startDate = user.studentProfile?.dateOfJoining ? new Date(user.studentProfile.dateOfJoining) : new Date();
        const endDate = certificateData?.issueDate ? new Date(certificateData.issueDate) : new Date();
        
        doc.font('Helvetica')
           .fontSize(14)
           .fillColor('#444444')
           .text(`Training Period: ${startDate.toLocaleDateString('en-GB')} to ${endDate.toLocaleDateString('en-GB')}`, 80, 370);

        // 6. Verification Grid (Higher up to avoid signature overlap)
        const gridY = 410;
        doc.rect(80, gridY, width - 160, 60).lineWidth(1).stroke('#eeeeee');
        
        const colW = (width - 160) / 3;
        const addGridItem = (label, value, x) => {
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#718096').text(label, x, gridY + 15, { width: colW, align: 'center' });
            doc.font('Helvetica-Bold').fontSize(12).fillColor(primaryColor).text(value, x, gridY + 30, { width: colW, align: 'center' });
        };

        const progressVal = progress?.progressPercent || 100;
        let grade = 'B';
        if (progressVal >= 90) grade = 'A+';
        else if (progressVal >= 75) grade = 'A';
        else if (progressVal >= 60) grade = 'B+';

        addGridItem('GRADE', grade, 80);
        addGridItem('TOTAL SCORE', `${progressVal}%`, 80 + colW);
        addGridItem('VERIFICATION ID', certificateData?.certificateId || 'N/A', 80 + (colW * 2));

        // 7. Footer - Signatures & Seal (Spaced out)
        const footerY = height - 150;
        const footerLineY = height - 80;
        
        // ── LEFT SIDE: Founder Signature ──────────────────────────────────────
        const leftSignX = 80;
        const signatureToUse = settings?.general?.pdfCertificateSignature;
        if (signatureToUse) {
            try {
                if (signatureToUse.startsWith('data:image')) {
                    const buffer = Buffer.from(signatureToUse.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                    doc.image(buffer, leftSignX, footerY - 50, { height: 60 });
                } else if (signatureToUse.startsWith('http')) {
                    const response = await axios.get(signatureToUse, { responseType: 'arraybuffer' });
                    doc.image(Buffer.from(response.data, 'binary'), leftSignX, footerY - 50, { height: 60 });
                } else {
                    const signPath = path.join(process.cwd(), signatureToUse.startsWith('/') ? signatureToUse : '/' + signatureToUse);
                    if (fs.existsSync(signPath)) doc.image(signPath, leftSignX, footerY - 50, { height: 60 });
                }
            } catch (e) {
                doc.font('Times-Italic').fontSize(18).fillColor('#1a1a1a').text(settings?.general?.adminName || 'Authorized', leftSignX, footerY - 15, { width: 150, align: 'center' });
            }
        } else {
            doc.font('Times-Italic').fontSize(18).fillColor('#1a1a1a').text(settings?.general?.adminName || 'Authorized', leftSignX, footerY - 15, { width: 150, align: 'center' });
        }
        doc.moveTo(leftSignX, footerLineY).lineTo(leftSignX + 150, footerLineY).lineWidth(1).stroke(primaryColor);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(settings?.general?.adminName?.toUpperCase() || 'FOUNDER & CEO', leftSignX, footerLineY + 10, { width: 150, align: 'center' });
        doc.font('Helvetica').fontSize(7).fillColor('#777').text('HEAD OF ORGANIZATION', leftSignX, footerLineY + 20, { width: 150, align: 'center' });

        // ── CENTER: Official Seal ─────────────────────────────────────────────
        const sealToUse = settings?.general?.pdfCertificateSeal;
        if (sealToUse) {
            try {
                if (sealToUse.startsWith('data:image')) {
                    const buffer = Buffer.from(sealToUse.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                    doc.image(buffer, (width / 2) - 30, footerY - 40, { width: 60 });
                } else if (sealToUse.startsWith('http')) {
                    const response = await axios.get(sealToUse, { responseType: 'arraybuffer' });
                    doc.image(Buffer.from(response.data, 'binary'), (width / 2) - 30, footerY - 40, { width: 60 });
                }
            } catch (e) {}
        }

        // ── RIGHT SIDE: Academics Info ────────────────────────────────────────
        const rightInfoX = width - 230;
        doc.font('Times-Italic').fontSize(18).fillColor('#1a1a1a').text('Aman Srivastava', rightInfoX, footerY - 15, { width: 150, align: 'center' });
        doc.moveTo(rightInfoX, footerLineY).lineTo(rightInfoX + 150, footerLineY).lineWidth(1).stroke(primaryColor);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text('AMAN SRIVASTAVA', rightInfoX, footerLineY + 10, { width: 150, align: 'center' });
        doc.font('Helvetica').fontSize(7).fillColor('#777').text('HEAD OF ACADEMICS', rightInfoX, footerLineY + 20, { width: 150, align: 'center' });

        // 8. Footer Note
        doc.font('Helvetica').fontSize(8).fillColor('#999')
           .text(`Issued by ${settings?.general?.siteName || 'God of Graphics'} on ${new Date().toLocaleDateString('en-GB')} | Valid Credential`, 0, height - 35, { align: 'center', width: width });

    } catch (error) {
        console.error('Error generating Certificate Format 2:', error);
        throw error;
    }
};
