/**
 * Updates a user's login streak and XP points based on consecutive activity.
 * @param {Object} user - The mongoose user document.
 * @returns {Promise<Object>} - The updated user document (not saved).
 */
export const updateLoginStreak = async (user) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Ensure streaks object exists
    if (!user.streaks) {
        user.streaks = { current: 0, lastActive: null, maxStreak: 0 };
    }

    const lastActive = user.streaks.lastActive ? new Date(user.streaks.lastActive) : null;
    if (lastActive) lastActive.setHours(0, 0, 0, 0);

    if (!lastActive) {
        // First time login ever
        user.streaks = { 
            current: 1, 
            lastActive: new Date(), 
            maxStreak: 1 
        };
        user.xpPoints = (user.xpPoints || 0) + 10; // First login bonus
    } else if (today.getTime() > lastActive.getTime()) {
        // Only update if it's a new day
        const diffDays = Math.floor((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            // Consecutive day! Streak continues
            user.streaks.current += 1;
            if (user.streaks.current > (user.streaks.maxStreak || 0)) {
                user.streaks.maxStreak = user.streaks.current;
            }
            
            // Reward XP: 10 base + bonus for every 5 days
            let bonus = 0;
            if (user.streaks.current % 5 === 0) bonus = 50; 
            user.xpPoints = (user.xpPoints || 0) + 10 + bonus;
        } else if (diffDays > 1) {
            // Gap found! Streak resets to 1
            user.streaks.current = 1;
            user.xpPoints = (user.xpPoints || 0) + 10;
        }
        user.streaks.lastActive = new Date();
    }
    
    return user;
};
