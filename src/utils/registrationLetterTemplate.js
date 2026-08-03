import { format } from 'date-fns';

const generateRegistrationLetterHtml = (student, feeRecord, siteSettings) => {
    const today = format(new Date(), 'MMMM dd yyyy');
    const siteName = siteSettings?.general?.siteName || 'HN Techno';
    const siteLogo = siteSettings?.general?.logo || '';
    const contactInfo = siteSettings?.contact || {
        email: 'info@hntechno.com',
        phone: '+91-9173026598',
        address: '424 Gala Empire, Opp. Door-darshan Tower, S.G Highway, Thaltej, Ahmedabad - 380052'
    };

    const installments = [];
    if (feeRecord.emiEnabled) {
        const startDate = feeRecord.emiStartDate ? new Date(feeRecord.emiStartDate) : new Date();
        for (let i = 0; i < feeRecord.emiCount; i++) {
            const dueDate = new Date(startDate);
            dueDate.setMonth(startDate.getMonth() + i);
            
            // Check if this installment was already covered by initial payments
            // This is a simplification; in a real app we'd track each installment status
            const isPaid = i === 0 && feeRecord.paidAmount >= feeRecord.emiAmount;

            installments.push({
                amount: feeRecord.emiAmount,
                status: isPaid ? 'Paid' : 'Pending',
                dueDate: format(dueDate, 'd/M/yyyy')
            });
        }
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.4; margin: 0; padding: 0; }
        .container { max-width: 800px; margin: 20px auto; border: 1px solid #ddd; padding: 40px; background: #fff; }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #002D5B; padding-bottom: 15px; margin-bottom: 20px; }
        .logo-section img { height: 80px; }
        .contact-section { text-align: right; font-size: 11px; color: #444; }
        .contact-section b { color: #000; }
        
        .date-section { margin-bottom: 15px; font-weight: bold; }
        .student-info { margin-bottom: 20px; }
        .student-info p { margin: 2px 0; }
        
        .subject { text-align: center; text-decoration: underline; font-weight: bold; margin-bottom: 20px; font-size: 18px; }
        
        .welcome-msg { margin-bottom: 20px; }
        .welcome-msg b { color: #002D5B; }
        
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
        table, th, td { border: 1px solid #ccc; }
        th, td { padding: 8px; text-align: left; }
        .table-header { background-color: #f8f8f8; font-weight: bold; text-align: center; }
        
        .fees-table th { background-color: #f8f8f8; }
        .installments-table { font-size: 11px; }
        
        .terms { font-size: 10px; color: #555; }
        .terms h4 { margin-bottom: 5px; color: #000; }
        .terms ul { padding-left: 15px; margin-top: 5px; }
        .terms li { margin-bottom: 3px; }
        
        .footer { margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; font-size: 11px; display: flex; justify-content: space-between; align-items: flex-end; }
        .footer-left { color: #002D5B; font-weight: bold; }
        .footer-right { text-align: right; }
        
        .blue-bar { background: #002D5B; color: white; padding: 10px; font-size: 11px; display: flex; justify-content: space-between; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-section">
                <img src="${siteLogo || 'https://hntechno.com/wp-content/uploads/2023/11/hn-techno-logo.png'}" alt="Logo">
            </div>
            <div class="contact-section">
                <p><b>Email Id:</b> info@hntechno.com<br>info.hntechno@gmail.com</p>
                <p><b>Address:</b> 424 Gala Empire,<br>Opp. Door-darshan Tower,<br>S.G Highway, Thaltej<br>Ahmedabad - 380052</p>
                <p><b>Contact:</b> +91-9173026598</p>
                <p><b>Jurisdiction:</b> Gota</p>
            </div>
        </div>

        <div class="date-section">${today}</div>
        
        <div class="student-info">
            <p><b>${student.name}</b></p>
            <p>${student.address || ''}</p>
        </div>

        <div class="subject">Sub: Registration Confirmation Letter</div>

        <div class="welcome-msg">
            <p>Hi ${student.name.split(' ')[0]},</p>
            <p><b>Congratulations!</b> and Welcome to the ${siteName}'s Team!</p>
            <p>You've successfully completed registration for IT Training. Your registration is <b>confirmed</b>. Your training duration starts from <b>${format(new Date(), 'MMMM yyyy')}</b> and Expected to be complete by <b>${format(new Date(new Date().setMonth(new Date().getMonth() + 6)), 'MMMM yyyy')}</b>. You may find list for Type of Training you have chosen as well as your fees structure.</p>
        </div>

        <table>
            <tr class="table-header"><td colspan="2">Chosen Module</td></tr>
            <tr>
                <td width="40%"><b>Module Name</b></td>
                <td>Module - 1</td>
            </tr>
            <tr>
                <td><b>Course List</b></td>
                <td>${feeRecord.course?.title || 'Advanced IT Training'}</td>
            </tr>
            <tr>
                <td><b>Username / Password</b></td>
                <td>${student.email} / ${student.plainPassword || '******'}</td>
            </tr>
        </table>

        <table class="fees-table">
            <tr class="table-header"><td colspan="5">Fees Structure</td></tr>
            <tr>
                <th>Fees</th>
                <th>Total Discount</th>
                <th>Total Fees</th>
                <th>No. of Installments</th>
                <th>Fees Installments</th>
            </tr>
            <tr>
                <td>${feeRecord.totalFee}</td>
                <td>${feeRecord.discount}</td>
                <td>${feeRecord.finalFee}</td>
                <td align="center">${feeRecord.emiCount || 1}</td>
                <td style="padding: 0;">
                    <table class="installments-table" style="margin: 0; border: none; width: 100%;">
                        <tr style="background: #f0f0f0;">
                            <th style="border: none; border-bottom: 1px solid #ccc;">Installments</th>
                            <th style="border: none; border-bottom: 1px solid #ccc;">Status</th>
                            <th style="border: none; border-bottom: 1px solid #ccc;">Upcoming Payment Due</th>
                        </tr>
                        ${installments.map(ins => `
                            <tr>
                                <td style="border: none; border-bottom: 1px solid #eee;">${ins.amount}</td>
                                <td style="border: none; border-bottom: 1px solid #eee;">${ins.status}</td>
                                <td style="border: none; border-bottom: 1px solid #eee;">${ins.dueDate}</td>
                            </tr>
                        `).join('')}
                        ${installments.length === 0 ? `<tr><td colspan="3" align="center">One time payment</td></tr>` : ''}
                    </table>
                </td>
            </tr>
        </table>

        <div class="terms">
            <h4>Terms and Conditions</h4>
            <ul>
                <li>Fee once paid is not refundable under any circumstances.</li>
                <li>Students must provide proper details on a timely basis to provide timely access.</li>
                <li>Classes are meant to be used only by the student who registered with the ${siteName}. reserves the right to take necessary legal actions if the classes are shared with anyone without written permission from ${siteName}.</li>
                <li>If any student find out with sharing the ID and password with other students then his/her classes will be blocked and strict actions will be taken.</li>
                <li>No smoking and No drinking use allowed inside the institute.</li>
                <li>You're enrolling in our training programmes at your own will and interest. ${siteName} is not liable/responsible for any loss attributable to the wilful misconduct.</li>
                <li>Strict Legal Actions will be taken against those who are hampering Company's own reputation during/after completion of training programmes.</li>
                <li>If you're not performing any tasks during training, then ${siteName} will not able to responsible for any mislead.</li>
                <li>You'd inform us before 2 days, if you want to take dayoff.</li>
                <li>For online students, Camera must be ON during lecture.</li>
                <li>Arrangement of Recording and missed lecture will allocate only if student had given valid reasons priorly.</li>
                <li>If any student don't sign on joining letter, then ${siteName} will informed him/her only 1 to 2 times. Afterwards, if He/She doesn't reply then the whole responsibility would comes under Student.</li>
                <li>Lecture will be continue even if there is ONLY ONE Student present at the moment.</li>
                <li>Phones or Internet, if/when not in use for learning opportunities, to only be used in student's break time, or else in case of emergency. If any student gets caught, strict actions will be taken.</li>
                <li>The course end date for each student may vary based on individual progress. Students are expected to regularly engage in coursework and assessments and make satisfactory progress towards completion. Company won't be responsible for that.</li>
                <li>${siteName} may terminate the training at any time, with or without cause, if company finds any illegal activity.</li>
                <li>${siteName} provides 100% knowledge guarantee not for placement/job.</li>
            </ul>
            <p style="text-align: center; margin-top: 10px;">If you have any questions or concerns, feel free to contact me at ${contactInfo.email} or ${contactInfo.phone}.<br>
            <i>*This email has been generated automatically so it doesn't require e-signature.*</i></p>
        </div>

        <div class="blue-bar">
            <span>www.hntechno.com</span>
            <span>Deal in web site designing and Development</span>
        </div>
    </div>
</body>
</html>
    `;
};

export default generateRegistrationLetterHtml;
