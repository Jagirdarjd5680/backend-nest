import { getFirebaseAdmin } from './firebase.js';
import User from '../models/User.js';

/**
 * Send a push notification via Firebase Cloud Messaging (FCM).
 *
 * @param {Object} options
 * @param {string} options.title - Notification title
 * @param {string} options.body  - Notification body/message
 * @param {string} [options.imageUrl] - Optional image URL
 * @param {Object} [options.data] - Optional data payload (key-value strings)
 * @param {string[]} [options.userIds] - Array of MongoDB user IDs to send to
 * @param {string} [options.role] - Role filter: 'all', 'student', 'teacher', 'admin'
 * @param {string} [options.topic] - FCM topic to send to (alternative to userIds)
 * @returns {Promise<{success: boolean, sent: number, failed: number, errors: string[]}>}
 */
export const sendPushNotification = async ({ title, body, imageUrl, data = {}, userIds, role, topic }) => {
    const result = { success: false, sent: 0, failed: 0, errors: [] };

    try {
        const adminSDK = await getFirebaseAdmin();
        if (!adminSDK) {
            result.errors.push('Firebase Admin SDK not initialized. Please configure Firebase Service Account in Settings > Integrations.');
            return result;
        }

        const messaging = adminSDK.messaging();

        // Build notification payload
        const notification = { title, body };
        if (imageUrl) notification.imageUrl = imageUrl;

        // ── Send to a topic ──
        if (topic) {
            try {
                await messaging.send({
                    topic,
                    notification,
                    data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
                });
                result.sent = 1;
                result.success = true;
            } catch (err) {
                result.errors.push(`Topic send failed: ${err.message}`);
            }
            return result;
        }

        // ── Build query for user tokens ──
        let query = { fcmToken: { $exists: true, $ne: '' }, isActive: true, isDeleted: { $ne: true } };

        if (userIds && userIds.length > 0) {
            query._id = { $in: userIds };
        } else if (role && role !== 'all') {
            query.role = role;
        }

        const users = await User.find(query).select('fcmToken').lean();
        const tokens = users.map(u => u.fcmToken).filter(Boolean);

        if (tokens.length === 0) {
            result.errors.push('No users with FCM tokens found for the given criteria.');
            return result;
        }

        // FCM supports max 500 tokens per multicast
        const batchSize = 500;
        for (let i = 0; i < tokens.length; i += batchSize) {
            const batch = tokens.slice(i, i + batchSize);

            try {
                const response = await messaging.sendEachForMulticast({
                    tokens: batch,
                    notification,
                    data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
                    android: {
                        priority: 'high',
                        notification: {
                            sound: 'default',
                            channelId: 'high_importance_channel',
                        },
                    },
                    apns: {
                        payload: {
                            aps: {
                                sound: 'default',
                                badge: 1,
                            },
                        },
                    },
                });

                result.sent += response.successCount;
                result.failed += response.failureCount;

                // Clean up invalid tokens
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const errCode = resp.error?.code;
                        if (
                            errCode === 'messaging/registration-token-not-registered' ||
                            errCode === 'messaging/invalid-registration-token'
                        ) {
                            // Remove invalid token from user
                            User.updateOne({ fcmToken: batch[idx] }, { $unset: { fcmToken: '' } }).catch(() => { });
                        }
                    }
                });
            } catch (batchErr) {
                result.errors.push(`Batch send error: ${batchErr.message}`);
            }
        }

        result.success = result.sent > 0;
        return result;
    } catch (error) {
        result.errors.push(error.message);
        return result;
    }
};

export default sendPushNotification;
