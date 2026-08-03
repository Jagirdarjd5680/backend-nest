import Counter from '../models/Counter.js';
import Settings from '../models/Settings.js';

/**
 * Generate the next PDF number based on type and admin prefix settings
 * @param {String} type - 'registration', 'receipt', 'invoice', 'emi_receipt', 'admission_letter'
 * @returns {Promise<String>} - Formatted PDF number (e.g. REG-0001)
 */
export const getNextPdfNumber = async (type) => {
    const settings = await Settings.findOne();
    const pdfSettings = settings?.pdfSettings || {};

    let prefix = '';
    let counterId = '';

    switch (type) {
        case 'registration':
            prefix = pdfSettings.registrationPrefix || 'REG';
            counterId = 'pdf_registration';
            break;
        case 'receipt':
            prefix = pdfSettings.receiptPrefix || 'REC';
            counterId = 'pdf_receipt';
            break;
        case 'invoice':
            prefix = pdfSettings.invoicePrefix || 'INV';
            counterId = 'pdf_invoice';
            break;
        case 'emi_receipt':
            prefix = pdfSettings.emiReceiptPrefix || 'EMI';
            counterId = 'pdf_emi_receipt';
            break;
        case 'admission_letter':
            prefix = pdfSettings.admissionLetterPrefix || 'ADM';
            counterId = 'pdf_admission_letter';
            break;
        default:
            prefix = 'GEN';
            counterId = 'pdf_general';
    }

    const counter = await Counter.findOneAndUpdate(
        { id: counterId },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    const padding = pdfSettings.numberPadding || 4;
    const separator = pdfSettings.numberSeparator || '-';
    const position = pdfSettings.prefixPosition || 'start';
    const suffix = pdfSettings.suffix || '';
    
    const sequenceNumber = counter.seq.toString().padStart(padding, '0');
    
    let result = '';
    if (position === 'start') {
        result = `${prefix}${separator}${sequenceNumber}`;
    } else {
        result = `${sequenceNumber}${separator}${prefix}`;
    }

    if (suffix) {
        result += `${separator}${suffix}`;
    }

    return result;
};
