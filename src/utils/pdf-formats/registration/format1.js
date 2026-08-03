import axios from 'axios';
import fs from 'fs';
import path from 'path';

export const generateFormat1 = async (doc, { user, feeRecord, settings, pdfNumber }) => {
    const primaryColor = settings?.theme?.primaryColor || '#002D5B';
    const siteName = settings?.general?.siteName || 'LMS';
    
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

    // Contact Info (Right)
    const companyEmails = settings?.company?.email ? settings.company.email.split('\n') : [settings?.general?.adminEmail || 'info@example.com'];
    doc.fillColor('#444').fontSize(9).font('Helvetica').text(`Email Id: ${companyEmails[0]}`, 350, 40, { align: 'right' });
    if (companyEmails[1]) doc.text(companyEmails[1], 350, 52, { align: 'right' });
    
    const companyAddr = settings?.company?.address || 'Address Not Set';
    doc.text(`Address: ${companyAddr.split('\n').join(' ')}`, 300, 65, { align: 'right', width: 250 });
    doc.text(`Contact: ${settings?.company?.contact || ''}`, 350, 90, { align: 'right' });
    doc.text(`Jurisdiction: ${settings?.company?.jurisdiction || ''}`, 350, 102, { align: 'right' });

    doc.moveTo(40, 130).lineTo(555, 130).strokeColor(primaryColor).lineWidth(2).stroke();

    // --- 2. Body ---
    doc.moveDown(3);
    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), 40);
    doc.moveDown(0.5);
    doc.text(`Ref No: ${pdfNumber || 'N/A'}`);
    doc.moveDown(0.5);
    doc.text(user.name.toUpperCase());
    doc.font('Helvetica').fontSize(10).text(user.studentProfile?.address || user.address || '');
    doc.text(`Roll No: ${user.rollNumber || 'PENDING'}`);

    doc.moveDown(2);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryColor).text('Sub: Registration Confirmation Letter', { align: 'center', underline: true });
    doc.moveDown(2);

    doc.fillColor('#000').font('Helvetica').fontSize(11).text(`Hi ${user.name.split(' ')[0]},`);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Congratulations!', { continued: true }).font('Helvetica').text(` and Welcome to the ${siteName}'s Team!`);
    doc.moveDown(0.5);
    doc.text(`You've successfully completed registration for training. Your registration is `, { continued: true }).font('Helvetica-Bold').text('confirmed', { continued: true }).font('Helvetica').text(`. Your training duration and details are outlined below. You may find the type of training you have chosen as well as your fee structure.`);

    // --- 3. Tables ---
    doc.moveDown(2);
    // Table Header: Chosen Module
    doc.rect(40, doc.y, 515, 20).fill('#f8f8f8').stroke('#ccc');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('Chosen Module', 40, doc.y + 5, { align: 'center', width: 515 });
    doc.y += 20;

    const drawRow = (label, value) => {
        const y = doc.y;
        doc.rect(40, y, 150, 20).stroke('#ccc');
        doc.rect(190, y, 365, 20).stroke('#ccc');
        doc.font('Helvetica-Bold').text(label, 50, y + 5);
        doc.font('Helvetica').text(value, 200, y + 5);
        doc.y += 20;
    };

    drawRow('Course Name', feeRecord?.course?.title || 'Training Program');
    drawRow('Student Email', user.email);
    drawRow('Batch', feeRecord?.batch?.name || 'Assigned Soon');

    // Fees Table
    doc.moveDown(2);
    const feeTop = doc.y;
    doc.rect(40, feeTop, 515, 20).fill('#f8f8f8').stroke('#ccc');
    doc.fillColor('#000').font('Helvetica-Bold').text('Fees Structure', 40, feeTop + 5, { align: 'center', width: 515 });
    
    const colW = 103;
    const headerY = feeTop + 20;
    ['Total Fee', 'Discount', 'Net Fee', 'Installments', 'EMI Amount'].forEach((h, i) => {
        doc.rect(40 + (i * colW), headerY, colW, 30).fill('#f9f9f9').stroke('#ccc');
        doc.fillColor('#000').fontSize(9).text(h, 40 + (i * colW), headerY + 10, { align: 'center', width: colW });
    });

    const dataY = headerY + 30;
    const feeData = [
        `Rs. ${feeRecord?.totalFee || 0}`, 
        `Rs. ${feeRecord?.discount || 0}`, 
        `Rs. ${feeRecord?.finalFee || 0}`, 
        feeRecord?.emiCount || 1,
        `Rs. ${feeRecord?.emiAmount || 0}`
    ];
    feeData.forEach((d, i) => {
        doc.rect(40 + (i * colW), dataY, colW, 40).stroke('#ccc');
        doc.fontSize(10).text(d.toString(), 40 + (i * colW), dataY + 15, { align: 'center', width: colW });
    });

    // --- 4. Terms and Conditions ---
    doc.y = dataY + 60;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(primaryColor).text('Terms and Conditions', 40, doc.y, { underline: true });
    doc.moveDown(0.5);
    
    const rawTerms = settings?.policies?.termsAndConditions || 'Terms not set.';
    doc.fillColor('#444').font('Helvetica').fontSize(9);
    
    // Split terms by newline and render as bullets
    const termsList = rawTerms.split('\n').filter(t => t && t.trim());
    termsList.forEach(term => {
        const bulletText = `• ${term.trim()}`;
        // Calculate height with same options as text() call
        const textHeight = doc.heightOfString(bulletText, { 
            width: 515,
            indent: 10,
            align: 'justify'
        });
        
        // Only add a new page if the text won't fit AND we aren't already at the top of a page
        // Use a more conservative threshold (740) to avoid conflicting with pdfkit's auto-break
        if (doc.y + textHeight > 740 && doc.y > 100) {
            doc.addPage();
            doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10).text('Terms and Conditions (continued)', 40, 40);
            doc.moveDown(0.5);
            doc.fillColor('#444').font('Helvetica').fontSize(9);
        }
        
        doc.text(bulletText, { 
            indent: 10,
            width: 515,
            align: 'justify'
        });
        doc.moveDown(0.3);
    });

    // --- 5. Footer ---
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const footerY = doc.page.height - 50;
        doc.rect(0, footerY, doc.page.width, 25).fill(primaryColor);
        doc.fillColor('#fff').fontSize(9).text(settings?.general?.siteName || 'LMS', 40, footerY + 8);
        doc.text('Professional Education Platform', 300, footerY + 8, { align: 'right', width: 255 });
    }
};
