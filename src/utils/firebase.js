import admin from 'firebase-admin';
import Settings from '../models/Settings.js';

let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK using service account JSON stored in Settings.
 * Returns the admin instance if successful, null otherwise.
 */
export const getFirebaseAdmin = async () => {
    // Already initialized
    if (firebaseApp) return admin;

    try {
        const settings = await Settings.findOne();
        const serviceAccountJSON = settings?.integrations?.firebaseServiceAccount;

        if (!serviceAccountJSON) {
            
            return null;
        }

        let serviceAccount;
        try {
            serviceAccount = JSON.parse(serviceAccountJSON);
        } catch (parseErr) {
            console.error('❌ Firebase: Invalid service account JSON:', parseErr.message);
            return null;
        }

        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });

        
        return admin;
    } catch (error) {
        console.error('❌ Firebase initialization error:', error.message);
        return null;
    }
};

/**
 * Reset the Firebase app (useful if service account is updated in settings)
 */
export const resetFirebase = async () => {
    if (firebaseApp) {
        await firebaseApp.delete();
        firebaseApp = null;
    }
};

export default admin;
