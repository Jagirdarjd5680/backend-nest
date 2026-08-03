import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!googleClientId || !googleClientSecret) {
    console.error('❌ GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in .env file');
}

const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/live-classes/auth/callback'
);

export const getAuthUrl = () => {
    const scopes = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly'
    ];

    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });
};

export const getTokens = async (code) => {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
};

export const createMeetLink = async (tokens, classInfo) => {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
        summary: classInfo.title,
        description: classInfo.description,
        start: {
            dateTime: new Date(classInfo.scheduledDate).toISOString(),
            timeZone: 'Asia/Kolkata',
        },
        end: {
            dateTime: new Date(new Date(classInfo.scheduledDate).getTime() + (classInfo.duration * 60000)).toISOString(),
            timeZone: 'Asia/Kolkata',
        },
        conferenceData: {
            createRequest: {
                requestId: `meet-${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
        },
    };

    const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
    });

    return response.data.hangoutLink;
};
