import * as admin from 'firebase-admin';
import { initializeApp, cert } from 'firebase-admin/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let firebaseApp: any = null;

export const getFirebaseAdmin = async () => {
  if (firebaseApp) return admin;

  try {
    const settingsList = await prisma.settings.findMany();
    const serviceAccountJSON = settingsList.find(s => s.key === 'firebase_service_account')?.value;

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

    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
    });

    return admin;
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
    return null;
  }
};

export const resetFirebase = async () => {
  if (firebaseApp) {
    await firebaseApp.delete();
    firebaseApp = null;
  }
};

export default admin;
