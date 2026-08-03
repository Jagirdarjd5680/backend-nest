import axios from 'axios';
import fs from 'fs';
import path from 'path';

export const generateFormat2 = async (doc, { user, feeRecord, settings, pdfNumber }) => {
    const primaryColor = settings?.theme?.primaryColor || '#002D5B';
    const accentColor = '#d946ef';

    // Background Header
    doc.rect(0, 0, 595, 150).fill(primaryColor);
    
    // Site Logo
    const pdfLogo = settings?.general?.pdfLogo || settings?.general?.siteLogo;
    if (pdfLogo) {
        try {
            const base64Data = pdfLogo.replace(/^data:image\/\w+;base64,/, "");
            const logoBuffer = Buffer.from(base64Data, 'base64');
            doc.image(logoBuffer, 40, 40, { height: 60 });
        } catch (e) {
            doc.fillColor('#fff').fontSize(24).font('Helvetica-Bold').text(settings?.general?.siteName || 'GOD OF GRAPHICS', 40, 50);
        }
    } else {
        doc.fillColor('#fff').fontSize(24).font('Helvetica-Bold').text(settings?.general?.siteName || 'GOD OF GRAPHICS', 40, 50);
    }

    // Document Title
    doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold').text('OFFICIAL ADMISSION LETTER', 300, 50, { align: 'right', width: 255 });
    doc.fontSize(10).font('Helvetica').text(`Ref ID: ${pdfNumber}`, 300, 70, { align: 'right', width: 255 });
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 300, 85, { align: 'right', width: 255 });

    // Body
    doc.y = 170;
    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text('To,');
    doc.fontSize(14).text(user.name.toUpperCase(), 40, 185);
    doc.fontSize(10).font('Helvetica').fillColor('#444').text(user.studentProfile?.address || user.address || 'Address Not Provided');
    doc.text(`Phone: ${user.phone || 'N/A'}`);
    doc.text(`Email: ${user.email}`);

    doc.moveDown(2);
    doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('Subject: Confirmation of Admission and Batch Assignment', { underline: true });
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(11).font('Helvetica').text(`Dear ${user.name},`, { lineGap: 5 });
    doc.text(`We are pleased to inform you that your application for admission to the ${feeRecord?.course?.title || 'chosen course'} has been accepted. You are now officially enrolled as a student at ${settings?.general?.siteName || 'our institute'}.`, { align: 'justify', lineGap: 5 });

    // Detailed Grid
    doc.moveDown(2);
    const gridY = doc.y;
    
    const drawBox = (x, y, w, h, label, value) => {
        doc.rect(x, y, w, h).fill('#f8fafc').stroke('#e2e8f0');
        doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x + 10, y + 10);
        doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text(value || 'N/A', x + 10, y + 25, { width: w - 20 });
    };

    drawBox(40, gridY, 165, 50, 'Student ID', user.rollNumber || 'PENDING');
    drawBox(215, gridY, 165, 50, 'Course Name', feeRecord?.course?.title);
    drawBox(390, gridY, 165, 50, 'Batch Name', feeRecord?.batch?.name || 'To Be Assigned');

    const gridY2 = gridY + 60;
    drawBox(40, gridY2, 165, 50, 'Enrollment Date', new Date().toLocaleDateString());
    drawBox(215, gridY2, 165, 50, 'Payment Status', feeRecord?.status?.toUpperCase() || 'PENDING');
    drawBox(390, gridY2, 165, 50, 'Support Plan', 'Priority Support');

    // Fee Summary
    doc.y = gridY2 + 80;
    doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text('Fee Summary');
    doc.moveDown(0.5);
    
    const tableY = doc.y;
    doc.rect(40, tableY, 515, 20).fill(primaryColor);
    doc.fillColor('#fff').fontSize(9).text('Description', 50, tableY + 6);
    doc.text('Amount (INR)', 450, tableY + 6, { align: 'right', width: 95 });

    const row1Y = tableY + 20;
    doc.rect(40, row1Y, 515, 20).stroke('#e2e8f0');
    doc.fillColor('#000').text('Total Course Fee', 50, row1Y + 6);
    doc.text(`Rs. ${feeRecord?.totalFee || 0}`, 450, row1Y + 6, { align: 'right', width: 95 });

    const row2Y = row1Y + 20;
    doc.rect(40, row2Y, 515, 20).stroke('#e2e8f0');
    doc.fillColor('#000').text('Scholarship / Discount', 50, row2Y + 6);
    doc.fillColor('red').text(`- Rs. ${feeRecord?.discount || 0}`, 450, row2Y + 6, { align: 'right', width: 95 });

    const row3Y = row2Y + 20;
    doc.rect(40, row3Y, 515, 20).fill('#f1f5f9').stroke('#e2e8f0');
    doc.fillColor(primaryColor).font('Helvetica-Bold').text('Net Payable Amount', 50, row3Y + 6);
    doc.text(`Rs. ${feeRecord?.finalFee || 0}`, 450, row3Y + 6, { align: 'right', width: 95 });

    // Instruction Section
    doc.y = row3Y + 40;
    doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text('Important Instructions', 40, doc.y);
    doc.moveDown(0.5);
    doc.fillColor('#444').font('Helvetica').fontSize(9);
    const instructions = [
        'Ensure you have access to the student dashboard and mobile app.',
        'The course curriculum is available under the "Course Content" section.',
        'Assignments must be submitted before the specified deadlines.',
        'Maintain at least 80% attendance to qualify for the final certification.',
        'Join the official community group for real-time updates and discussions.'
    ];
    instructions.forEach(ins => {
        doc.text(`• ${ins}`, 40, doc.y, { lineGap: 3, width: 515 });
    });

    // Terms from settings
    doc.moveDown(1);
    doc.fillColor(primaryColor).font('Helvetica-Bold').text('Terms & Conditions:', 40, doc.y);
    doc.moveDown(0.5);
    doc.fillColor('#666').font('Helvetica').fontSize(8);
    
    const termsText = settings?.policies?.termsAndConditions || '';
    const tLines = termsText.split('\n').filter(t => t && t.trim());
    
    tLines.forEach(t => {
        const textHeight = doc.heightOfString(`• ${t.trim()}`, { 
            width: 515,
            align: 'justify',
            lineGap: 2
        });
        
        // Only add a new page if the text won't fit AND we aren't already at the top of a page
        if (doc.y + textHeight > 740 && doc.y > 100) {
            doc.addPage();
            doc.rect(20, 20, 555, 802).stroke(primaryColor);
            doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10).text('Terms & Conditions (continued):', 40, 40);
            doc.moveDown(0.5);
            doc.fillColor('#666').font('Helvetica').fontSize(8);
        }
        doc.text(`• ${t.trim()}`, { width: 515, align: 'justify', lineGap: 2 });
    });

    // Footer Signature
    doc.y = doc.page.height - 120;
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10).text('Authorized Signatory', 400, doc.y, { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#000').text(settings?.general?.siteName || 'God of Graphics', 400, doc.y + 20, { align: 'center' });

    // Border
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(20, 20, 555, 802).stroke(primaryColor);
    }
};
