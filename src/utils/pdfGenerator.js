import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate a professional registration confirmation letter PDF for a student
 * @param {Object} user - User object with populated enrolledCourses
 * @param {Object} feeRecord - FeeRecord object
 * @param {Object} settings - Settings object for branding and colors
 * @param {String} pdfNumber - Dynamic PDF number (e.g. REG-0001)
 */
export const generateRegistrationPDF = (user, feeRecord, settings, pdfNumber) => {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 40,
                size: 'A4',
                bufferPages: true
            });
            const fileName = `registration_${user.rollNumber || user._id}.pdf`;
            const filePath = path.join(__dirname, '..', 'uploads', 'certificates', fileName);

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            const primaryColor = settings?.theme?.primaryColor || '#002D5B';
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
            doc.fontSize(11).font('Helvetica-Bold').fillColor(primaryColor).text('Terms and Conditions', { underline: true });
            doc.moveDown(0.5);

            const rawTerms = settings?.policies?.termsAndConditions || 'Terms not set.';
            doc.fillColor('#444').font('Helvetica').fontSize(9);

            // Split terms by newline and render as bullets
            const termsList = rawTerms.split('\n').filter(t => t && t.trim());
            termsList.forEach(term => {
                const bulletText = `• ${term.trim()}`;
                const textHeight = doc.heightOfString(bulletText, { width: 515, align: 'justify' });

                // Check if we need a new page (Only if content exists on current page and next won't fit)
                if (doc.y + textHeight > 740 && doc.y > 100) {
                    doc.addPage();
                    doc.y = 40; // Reset Y for new page
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

            doc.end();
            stream.on('finish', () => resolve({ filePath, fileName }));
            stream.on('error', reject);
        } catch (error) { reject(error); }
    });
};

/**
 * Generate a Dynamic Registration PDF
 * @param {Object} user - User object
 * @param {Object} feeRecord - FeeRecord object
 * @param {Object} settings - Settings object
 * @param {String} pdfNumber - Dynamic PDF number
 */
export const generateDetailedRegistrationPDF = (user, feeRecord, settings, pdfNumber) => {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 40,
                size: 'A4',
                bufferPages: true
            });
            const fileName = `registration_${user.rollNumber || user._id}.pdf`;
            const filePath = path.join(__dirname, '..', 'uploads', 'certificates', fileName);

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Dynamic Template Selection
            const templateName = settings?.pdfFormats?.registrationTemplate || 'format1';
            try {
                const templatePath = `./pdf-formats/registration/${templateName}.js`;
                const { [`generate${templateName.charAt(0).toUpperCase() + templateName.slice(1)}`]: generatorFunc } = await import(templatePath);

                if (generatorFunc) {
                    await generatorFunc(doc, { user, feeRecord, settings, pdfNumber });
                } else {
                    const { generateFormat1 } = await import('./pdf-formats/registration/format1.js');
                    await generateFormat1(doc, { user, feeRecord, settings, pdfNumber });
                }
            } catch (err) {
                console.error('Registration Template Load Error:', err.message);
                const { generateFormat1 } = await import('./pdf-formats/registration/format1.js');
                await generateFormat1(doc, { user, feeRecord, settings, pdfNumber });
            }

            doc.end();
            stream.on('finish', () => resolve({ filePath, fileName }));
            stream.on('error', reject);
        } catch (error) { reject(error); }
    });
};

/**
 * Generate a fee receipt PDF
 * @param {Object} user - User object
 * @param {Object} payment - Payment object details
 * @param {Object} course - Course object
 * @param {Object} settings - Settings object
 * @param {String} pdfNumber - Dynamic PDF number (e.g. REC-0001)
 */
export const generateFeeReceiptPDF = async (user, payment, course, settings, pdfNumber) => {
    const FeeRecord = (await import('../models/FeeRecord.js')).default;
    const Payment = (await import('../models/Payment.js')).default;

    const record = await FeeRecord.findOne({ user: user._id, course: course._id });
    const allPayments = await Payment.find({
        user: user._id,
        course: course._id,
        status: 'completed'
    }).sort({ createdAt: 1 });

    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
            const fileName = `receipt_${payment.transactionId || Date.now()}.pdf`;
            const filePath = path.join(__dirname, '..', 'uploads', 'receipts', fileName);

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Dynamic Template Selection
            const templateName = settings?.pdfFormats?.receiptTemplate || 'format1';
            try {
                const templatePath = `./pdf-formats/payment/${templateName}.js`;
                const { [`generate${templateName.charAt(0).toUpperCase() + templateName.slice(1)}`]: generatorFunc } = await import(templatePath);

                if (generatorFunc) {
                    await generatorFunc(doc, { user, payment, course, record, allPayments, settings, pdfNumber });
                } else {
                    const { generateFormat1 } = await import('./pdf-formats/payment/format1.js');
                    await generateFormat1(doc, { user, payment, course, record, allPayments, settings, pdfNumber });
                }
            } catch (err) {
                console.error('Template Load Error:', err.message);
                // Hard fallback
                await generateFormat1(doc, { user, payment, course, record, allPayments, settings, pdfNumber });
            }

            doc.end();
            stream.on('finish', () => resolve({ filePath, fileName }));
            stream.on('error', reject);
        } catch (error) { reject(error); }
    });
};
/**
 * Generate a Certificate PDF
 * @param {Object} user - User object
 * @param {Object} course - Course object
 * @param {Object} progress - CourseProgress object
 * @param {Object} settings - Settings object
 * @param {Object} certificateData - Extra data like issueDate, certificateId
 */
export const generateCertificatePDF = (user, course, progress, settings, certificateData) => {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 0, // No margin for full background certificates
                size: 'A4',
                layout: 'landscape',
                bufferPages: true
            });
            
            const fileName = `certificate_${user.rollNumber || user._id}_${course._id}.pdf`;
            const filePath = path.join(__dirname, '..', 'uploads', 'certificates', fileName);

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Dynamic Template Selection
            const templateName = settings?.pdfFormats?.certificateTemplate || 'format1';
            try {
                const templatePath = `./pdf-formats/certificate/${templateName}.js`;
                const { [`generate${templateName.charAt(0).toUpperCase() + templateName.slice(1)}`]: generatorFunc } = await import(templatePath);

                if (generatorFunc) {
                    await generatorFunc(doc, { user, course, progress, settings, certificateData });
                } else {
                    const { generateFormat1 } = await import('./pdf-formats/certificate/format1.js');
                    await generateFormat1(doc, { user, course, progress, settings, certificateData });
                }
            } catch (err) {
                console.error('Certificate Template Load Error:', err.message);
                const { generateFormat1 } = await import('./pdf-formats/certificate/format1.js');
                await generateFormat1(doc, { user, course, progress, settings, certificateData });
            }

            doc.end();
            stream.on('finish', () => resolve({ filePath, fileName }));
            stream.on('error', reject);
        } catch (error) { reject(error); }
    });
};
