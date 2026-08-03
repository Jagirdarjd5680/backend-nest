import Assignment from '../models/Assignment.js';
import AssignmentUnlock from '../models/AssignmentUnlock.js';
import Exam from '../models/Exam.js';
import ExamUnlock from '../models/ExamUnlock.js';

/**
 * Checks for assignments linked to a specific module/lecture and unlocks them for a batch.
 * @param {String} courseId 
 * @param {String} batchId 
 * @param {String} moduleId 
 * @param {String} lectureId 
 */
export const checkAndUnlockAssignments = async (courseId, batchId, moduleId, lectureId, assignmentIds, examIds) => {
    try {
        if (!courseId || !batchId || !moduleId) {
            return;
        }

        const query = { course: courseId, moduleId };
        
        if (assignmentIds) {
            // Handle both single ID string and array of IDs
            const ids = Array.isArray(assignmentIds) ? assignmentIds : [assignmentIds];
            if (ids.length > 0) {
                query._id = { $in: ids };
            }
        } else if (lectureId) {
            // Priority 2: Targeted lecture
            query.lectureId = lectureId;
        } else {
            // Priority 3: Module-level general assignments
            query.$or = [
                { lectureId: { $exists: false } },
                { lectureId: null }
            ];
        }

        const assignments = await Assignment.find(query);
        if (assignments.length > 0) {
            for (const assignment of assignments) {
                await AssignmentUnlock.findOneAndUpdate(
                    { assignment: assignment._id, batch: batchId },
                    { 
                        assignment: assignment._id, 
                        batch: batchId, 
                        course: courseId, 
                        unlockedAt: new Date() 
                    },
                    { upsert: true, new: true }
                );
            }
        }

        // --- EXAM UNLOCK LOGIC ---
        const examQuery = { 
            $or: [
                { course: courseId },
                { courses: courseId }
            ],
            moduleId 
        };
        
        if (examIds) {
            const eIds = Array.isArray(examIds) ? examIds : [examIds];
            if (eIds.length > 0) {
                examQuery._id = { $in: eIds };
            }
        } else if (lectureId) {
            examQuery.lectureId = lectureId;
        } else {
            examQuery.$or = [
                { lectureId: { $exists: false } },
                { lectureId: null }
            ];
        }

        const exams = await Exam.find(examQuery);
        if (exams.length > 0) {
            for (const exam of exams) {
                await ExamUnlock.findOneAndUpdate(
                    { exam: exam._id, batch: batchId },
                    { 
                        exam: exam._id, 
                        batch: batchId, 
                        course: courseId, 
                        unlockedAt: new Date() 
                    },
                    { upsert: true, new: true }
                );
            }
        }
    } catch (error) {
        console.error('💥 [UnlockHelper] Error in checkAndUnlockAssignments:', error);
    }
};
