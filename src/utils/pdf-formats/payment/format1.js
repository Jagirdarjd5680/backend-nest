import fs from 'fs';
import path from 'path';
import axios from 'axios';

export const generateFormat1 = async (doc, { user, payment, course, record, settings, pdfNumber }) => {
    const primaryColor = settings?.theme?.primaryColor || '#002D5B';
    const lightGrey = '#f4f4f4';
    const siteName = settings?.general?.siteName || 'God of Graphics';

    // --- 1. Header ---
    const pdfLogo = settings?.general?.pdfLogo;
    const siteLogo = settings?.general?.siteLogo;
    const logoToUse = pdfLogo || siteLogo;

    if (logoToUse) {
        try {
            if (logoToUse.startsWith('data:image')) {
                const base64Data = logoToUse.replace(/^data:image\/\w+;base64,/, "");
                const logoBuffer = Buffer.from(base64Data, 'base64');
                doc.image(logoBuffer, 40, 40, { height: 60 });
            } else if (logoToUse.startsWith('http')) {
                const response = await axios.get(logoToUse, { responseType: 'arraybuffer' });
                const logoBuffer = Buffer.from(response.data, 'binary');
                doc.image(logoBuffer, 40, 40, { height: 60 });
            } else {
                const logoPath = path.join(process.cwd(), logoToUse.startsWith('/') ? logoToUse : '/' + logoToUse);
                if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 40, { height: 60 });
            }
        } catch (e) {
            doc.fontSize(20).font('Helvetica-Bold').fillColor(primaryColor).text(siteName, 40, 50);
        }
    } else {
        doc.fontSize(20).font('Helvetica-Bold').fillColor(primaryColor).text(siteName, 40, 50);
    }

    // Company Info (Right)
    doc.fillColor('#444').fontSize(9).font('Helvetica');
    const companyEmails = settings?.company?.email ? settings.company.email.split('\n') : ['info@godofgraphics.com'];
    doc.text(`Email Id: ${companyEmails[0]}`, 300, 40, { align: 'right' });
    const companyAddr = settings?.company?.address ? settings.company.address.split('\n').join(' ') : 'Address Not Set';
    doc.text(`Address: ${companyAddr}`, 300, 52, { align: 'right', width: 255 });
    doc.text(`Contact: ${settings?.company?.contact || ''}`, 300, 77, { align: 'right' });
    doc.text(`Jurisdiction: ${settings?.company?.jurisdiction || ''}`, 300, 90, { align: 'right' });

    doc.moveTo(40, 120).lineTo(555, 120).strokeColor(primaryColor).lineWidth(2).stroke();

    // --- 2. Invoice & Method Info Boxes ---
    doc.moveDown(2);
    const boxY = doc.y;
    doc.rect(40, boxY, 250, 40).fill(lightGrey);
    doc.fillColor('#333').fontSize(9).font('Helvetica-Bold').text(`Invoice: #${pdfNumber || payment.transactionId || 'MANUAL-' + Date.now()}`, 50, boxY + 10);
    doc.font('Helvetica').text(new Date(payment.paidAt || payment.createdAt).toLocaleDateString(), 50, boxY + 22);

    doc.rect(305, boxY, 250, 40).fill(lightGrey);
    doc.fillColor('#333').font('Helvetica-Bold').text('Payment Method', 315, boxY + 10);
    doc.font('Helvetica').text((payment.paymentMethod || payment.method || 'Offline').toUpperCase(), 315, boxY + 22);

    // --- 3. Student Info ---
    doc.y = boxY + 60;
    doc.fillColor('#000').font('Helvetica-Bold').text(`Student Name : `, 40, doc.y, { continued: true }).font('Helvetica').text(user.name);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(`Student Address : `, 40, doc.y, { continued: true }).font('Helvetica').text(user.studentProfile?.address || 'N/A');
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(`Roll Number : `, 40, doc.y, { continued: true }).font('Helvetica').text(user.rollNumber || '---');

    // --- 4. Main Table ---
    doc.moveDown(2);
    const tableTop = doc.y;
    const colWidths = [150, 80, 80, 80, 125];
    const headers = ['Module Name', 'Total Fees', 'Paid', 'Discount', 'Remaining Fees'];

    doc.rect(40, tableTop, 515, 25).fill(primaryColor);
    headers.forEach((h, i) => {
        const x = 40 + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold').text(h, x, tableTop + 8, { width: colWidths[i], align: 'center' });
    });

    const rowY = tableTop + 25;
    doc.rect(40, rowY, 515, 60).stroke('#ccc');
    let currentX = 40;
    colWidths.slice(0, -1).forEach(w => {
        currentX += w;
        doc.moveTo(currentX, rowY).lineTo(currentX, rowY + 60).stroke('#ccc');
    });

    const data = [
        course.title,
        `Rs. ${record?.finalFee || 0}`,
        `Rs. ${payment.amount}`,
        `Rs. ${record?.discount || 0}`,
        `Rs. ${record?.remainingAmount || 0}`
    ];
    data.forEach((d, i) => {
        const x = 40 + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.fillColor('#333').font('Helvetica').text(d.toString(), x, rowY + 20, { width: colWidths[i], align: 'center' });
    });

    // --- 5. Terms & Conditions Box ---
    doc.y = rowY + 80;
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10).text('Terms and Conditions', 40, doc.y, { underline: true });
    doc.moveDown(0.5);
    
    const rawTerms = settings?.policies?.termsAndConditions || 'Terms not set.';
    doc.fillColor('#444').font('Helvetica').fontSize(8);
    
    const termsList = rawTerms.split('\n').filter(t => t.trim());
    termsList.forEach(term => {
        const bulletText = `• ${term.trim()}`;
        const textHeight = doc.heightOfString(bulletText, { width: 515 });
        
        if (doc.y + textHeight > 780) {
            doc.addPage();
            doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10).text('Terms and Conditions (continued)', 40, 40);
            doc.moveDown(0.5);
            doc.fillColor('#444').font('Helvetica').fontSize(8);
        }
        
        doc.text(bulletText, 40, doc.y, { 
            indent: 10,
            width: 515,
            align: 'justify'
        });
        doc.moveDown(0.2);
    });

    // --- 6. Footer Signature ---
    doc.moveDown(2);
    if (doc.y > 780) doc.addPage();
    doc.fillColor('#333').font('Helvetica-Bold').fontSize(9).text('"This is an electronically generated report, hence does not require a signature"', { align: 'center' });
};
