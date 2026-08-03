import mongoose from 'mongoose';

/**
 * Helper to calculate student progress percentage for a course
 * Weightage: 50% Lectures, 50% Assignment Grades
 */
export const calculateCourseProgress = async (userId, courseId) => {
    try {
        const Course = mongoose.model('Course');
        const Assignment = mongoose.model('Assignment');
        const CourseProgress = mongoose.model('CourseProgress');

        const course = await Course.findById(courseId);
        if (!course) return 0;

        // 1. Lectures Progress (50% weight)
        const totalVideos = course.modules.reduce((sum, mod) => sum + (mod.videos?.length || 0), 0);
        const progress = await CourseProgress.findOne({ user: userId, course: courseId });
        const completedVideosCount = progress?.completedVideos?.length || 0;
        
        const lectureScore = totalVideos > 0 
            ? (completedVideosCount / totalVideos) * 50 
            : 0;

        // 2. Assignments Progress (50% weight)
        const assignments = await Assignment.find({ 
            $or: [
                { course: courseId },
                { batch: { $in: course.assignedBatches || [] } }
            ],
            isPublished: true
        });

        let totalPossibleMarks = 0;
        let totalStudentMarks = 0;
        let completedAssignments = [];

        assignments.forEach(asm => {
            totalPossibleMarks += (asm.totalMarks || 100);
            const submission = asm.submissions?.find(s => s.student.toString() === userId.toString());
            if (submission) {
                if (submission.status === 'graded') {
                    totalStudentMarks += (submission.grade || 0);
                    completedAssignments.push(asm._id);
                }
                // Removed: pending submissions no longer count towards progress % until graded
            }
        });

        const assignmentScore = assignments.length > 0 
            ? (completedAssignments.length / assignments.length) * 50 
            : 0;

        let totalPercent = 0;
        if (totalVideos > 0 && assignments.length > 0) {
            // 50/50 Split (Lectures / Assignment Submissions)
            totalPercent = Math.round(lectureScore + assignmentScore);
        } else if (totalVideos > 0) {
            // Lectures only (100%)
            totalPercent = Math.round((completedVideosCount / totalVideos) * 100);
        } else if (assignments.length > 0) {
            // Assignments only (100%)
            totalPercent = Math.round((completedAssignments.length / assignments.length) * 100);
        }

        totalPercent = Math.min(100, totalPercent);

        // Update or Create progress record
        if (progress) {
            progress.progressPercent = totalPercent;
            progress.completedAssignments = completedAssignments;
            await progress.save();
        } else {
            await CourseProgress.create({
                user: userId,
                course: courseId,
                progressPercent: totalPercent,
                completedAssignments: completedAssignments
            });
        }

        return totalPercent;
    } catch (error) {
        console.error('Progress calculation error:', error);
        return 0;
    }
};
