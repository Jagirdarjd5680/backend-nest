import fs from 'fs';
import path from 'path';
import axios from 'axios';

export const generateFormat2 = async (doc, { user, payment, course, record, allPayments, settings, pdfNumber }) => {
    const primaryColor = settings?.theme?.primaryColor || '#f39c12';
    const siteName = settings?.general?.siteName || 'GOD OF GRAPHICS';

    // GST Logic as per USER requirement (18% of total fee)
    const totalCourseFee = record?.finalFee || 0;
    const courseGstTotal = totalCourseFee * 0.18; // 18% of 35000 = 6300
    const courseBaseTotal = totalCourseFee - courseGstTotal; // 28700
    const courseSgst = courseGstTotal / 2;
    const courseCgst = courseGstTotal / 2;

    const paidNow = payment.amount;
    const totalPaidSoFar = record?.paidAmount || 0;
    const balanceDue = totalCourseFee - totalPaidSoFar;

    // --- Header ---
    doc.fillColor('#1a1a2e').fontSize(18).font('Helvetica-Bold').text(siteName.toUpperCase(), 40, 40);
    doc.fillColor('#444').fontSize(9).font('Helvetica');
    const addr = settings?.company?.address || 'Address Not Set';
    doc.text(addr, 40, 62, { width: 300, lineGap: 2 });
    
    // Position phone/email relatively
    doc.y += 2;
    doc.text(`Phone no.: ${settings?.company?.contact || ''}`, 40, doc.y);
    const companyEmail = settings?.company?.email ? settings.company.email.split('\n')[0] : '';
    doc.text(`Email: ${companyEmail}`, 40, doc.y + 2);

    // Logo (Top Right)
    const logoToUse = settings?.general?.pdfLogo || settings?.general?.siteLogo;
    if (logoToUse) {
        try {
            if (logoToUse.startsWith('data:image')) {
                const buffer = Buffer.from(logoToUse.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                doc.image(buffer, 440, 40, { width: 80 });
            } else if (logoToUse.startsWith('http')) {
                const res = await axios.get(logoToUse, { responseType: 'arraybuffer' });
                doc.image(Buffer.from(res.data), 440, 40, { width: 80 });
            } else {
                const p = path.join(process.cwd(), logoToUse.startsWith('/') ? logoToUse : '/' + logoToUse);
                if (fs.existsSync(p)) doc.image(p, 440, 40, { width: 80 });
            }
        } catch (e) {}
    }

    // Title
    doc.y = 140; // Ensure title starts below header
    doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('Tax Invoice', { align: 'center' });

    // --- Bill To & Invoice Info ---
    doc.moveDown(1);
    const infoY = doc.y;
    
    // Left side: Bill To
    doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Bill To', 40, infoY);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Student Name: ${user.name}`, 40, infoY + 15);
    doc.text(`Email: ${user.email}`, 40, infoY + 27);
    doc.text(`Roll No: ${user.rollNumber || '---'}`, 40, infoY + 39);
    doc.text(`Contact: ${user.phone || '---'}`, 40, infoY + 51);

    // Right side: Invoice Details
    doc.font('Helvetica-Bold').fontSize(10).text('Invoice Details', 400, infoY, { align: 'right' });
    doc.font('Helvetica').fontSize(9);
    doc.text(`Invoice No.: ${pdfNumber || 'INV-' + Date.now()}`, 300, infoY + 15, { align: 'right', width: 255 });
    doc.text(`Date: ${new Date(payment.paidAt || payment.createdAt).toLocaleDateString()}`, 300, infoY + 27, { align: 'right', width: 255 });

    // Ensure we are below the tallest section before starting the table
    doc.y = Math.max(doc.y, infoY + 70);
    doc.moveDown(2);
    const tableTop = doc.y;
    const colW = [30, 190, 60, 50, 70, 65, 50]; // Total 515
    const headers = ['#', 'Item name', 'HSN/ SAC', 'Quantity', 'Price/ Unit', 'GST', 'Amount'];

    doc.rect(40, tableTop, 515, 25).fill(primaryColor);
    let curX = 40;
    headers.forEach((h, i) => {
        doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold').text(h, curX, tableTop + 8, { width: colW[i], align: i === 1 ? 'left' : 'center' });
        curX += colW[i];
    });

    const rowY = tableTop + 25;
    doc.rect(40, rowY, 515, 60).stroke('#ccc');
    
    // Vertical lines
    let lineX = 40;
    colW.slice(0, -1).forEach(w => {
        lineX += w;
        doc.moveTo(lineX, rowY).lineTo(lineX, rowY + 60).stroke('#ccc');
    });

    // Row Data
    doc.fillColor('#333').font('Helvetica').fontSize(8);
    doc.text('1', 40, rowY + 15, { width: colW[0], align: 'center' });
    doc.text(course.title, 75, rowY + 15, { width: colW[1] - 10 });
    doc.text('9983', 40 + colW[0] + colW[1], rowY + 15, { width: colW[2], align: 'center' });
    doc.text('1', 40 + colW[0] + colW[1] + colW[2], rowY + 15, { width: colW[3], align: 'center' });
    
    // Show Base Course Fee (28700) in Price/Unit
    doc.text(`Rs. ${Math.round(courseBaseTotal)}`, 40 + colW[0] + colW[1] + colW[2] + colW[3], rowY + 15, { width: colW[4], align: 'center' });
    
    // Show GST Amount (6300)
    doc.text(`Rs. ${Math.round(courseGstTotal)}\n(18%)`, 40 + colW[0] + colW[1] + colW[2] + colW[3] + colW[4], rowY + 10, { width: colW[5], align: 'center' });
    
    // Show Current Amount being paid
    doc.text(`Rs. ${paidNow}`, 40 + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5], rowY + 15, { width: colW[6], align: 'center' });

    // Table Total Net
    doc.rect(40, rowY + 60, 515, 20).fill('#f9f9f9').stroke('#ccc');
    doc.fillColor('#000').font('Helvetica-Bold').text('Total (Current) Paid', 40, rowY + 66, { width: 460, align: 'right' });
    doc.text(`Rs. ${paidNow}`, 505, rowY + 66, { width: 50, align: 'center' });

    // --- Footer Section ---
    doc.moveDown(3);
    const footerY = doc.y;

    // Left: Payment History
    doc.fontSize(9).font('Helvetica-Bold').text('Payment History:', 40, footerY);
    doc.moveDown(0.5);
    
    const histColW = [25, 80, 60, 60];
    const histHeaders = ['#', 'Date', 'Type', 'Amount'];
    const histTop = doc.y;
    
    doc.rect(40, histTop, 225, 18).fill('#f1f5f9').stroke('#ccc');
    let hX = 40;
    histHeaders.forEach((h, i) => {
        doc.fillColor('#333').fontSize(7).font('Helvetica-Bold').text(h, hX, histTop + 5, { width: histColW[i], align: 'center' });
        hX += histColW[i];
    });
 
    let hY = histTop + 18;
    // Use record.payments if allPayments is missing or incomplete
    const historyData = (record?.payments && record.payments.length > 0) ? record.payments : (allPayments || []);
    const filteredPayments = historyData.filter(p => p.amount > 0);
    
    filteredPayments.forEach((p, idx) => {
        doc.rect(40, hY, 225, 15).stroke('#eee');
        doc.fillColor('#444').fontSize(7).font('Helvetica');
        doc.text(idx + 1, 40, hY + 4, { width: histColW[0], align: 'center' });
        doc.text(new Date(p.paidAt || p.createdAt).toLocaleDateString(), 40 + histColW[0], hY + 4, { width: histColW[1], align: 'center' });
        doc.text((p.method || p.paymentMethod || 'CASH').toUpperCase().replace('_', ' '), 40 + histColW[0] + histColW[1], hY + 4, { width: histColW[2], align: 'center' });
        doc.text(`Rs. ${p.amount}`, 40 + histColW[0] + histColW[1] + histColW[2], hY + 4, { width: histColW[3], align: 'center' });
        hY += 15;
    });
 
    // Right: Calculation Box
    const calcX = 380;
    const calcY = footerY;
    
    const drawCalcRow = (label, value, isBold = false, color = '#000') => {
        doc.fillColor(color).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        doc.text(label, calcX, doc.y, { width: 100, align: 'right' });
        doc.text(`Rs. ${value}`, calcX + 110, doc.y, { width: 65, align: 'right' });
        doc.moveDown(0.6);
    };
 
    doc.y = calcY;
    drawCalcRow('Subtotal:', Math.round(courseBaseTotal));
    drawCalcRow('CGST (9.00%):', Math.round(courseCgst));
    drawCalcRow('SGST (9.00%):', Math.round(courseSgst));
    
    doc.moveTo(calcX + 50, doc.y).lineTo(calcX + 175, doc.y).stroke('#ccc');
    doc.moveDown(0.5);
    
    drawCalcRow('Grand Total:', totalCourseFee, true, primaryColor);
    drawCalcRow('Total Paid:', totalPaidSoFar, true, '#10b981');
    
    doc.rect(calcX + 50, doc.y, 125, 20).fill('#fef2f2').stroke('#fee2e2');
    doc.fillColor('#d32f2f').font('Helvetica-Bold').text('Balance Due:', calcX + 55, doc.y + 6);
    doc.text(`Rs. ${balanceDue}`, calcX + 130, doc.y, { width: 40, align: 'right' });
 
    // Terms and Conditions (FULL WIDTH)
    doc.y = Math.max(hY + 20, doc.y + 40);
    const tcTitle = 'Terms and Conditions:';
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(tcTitle, 40);
    doc.moveDown(0.5);
    
    const termsText = settings?.policies?.termsAndConditions || '1. Fees once paid are non-refundable.';
    doc.font('Helvetica').fontSize(8).fillColor('#444');
    
    const tLines = termsText.split('\n').filter(t => t.trim());
    tLines.forEach(line => {
        const bulletText = line.trim().startsWith('•') ? line.trim() : `• ${line.trim()}`;
        const textHeight = doc.heightOfString(bulletText, { width: 515 });
        
        if (doc.y + textHeight > 750) {
            doc.addPage();
            doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(tcTitle + ' (continued)', 40, 40);
            doc.moveDown(0.5);
            doc.font('Helvetica').fontSize(8).fillColor('#444');
        }
        doc.text(bulletText, 40, doc.y, { width: 515, align: 'justify', lineGap: 2 });
    });

    // Authorized Signatory
    doc.y = doc.page.height - 100;
    doc.fillColor('#333').font('Helvetica').fontSize(9).text(`For: ${siteName.toUpperCase()}`, 400, doc.y, { align: 'center', width: 155 });
    doc.moveTo(400, doc.y + 40).lineTo(555, doc.y + 40).stroke('#333').lineWidth(0.5).stroke();
    doc.text('Authorized Signatory', 400, doc.y + 45, { align: 'center', width: 155 });
};
