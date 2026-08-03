// `type` values for RealtimeService broadcasts — keep in sync with the switch
// in frontend/src/context/AuthContext.jsx that turns these into toasts. Add a
// new entry here + a `case` there whenever a feature starts emitting real-time
// updates instead of hardcoding the string in both places.
export const REALTIME_EVENTS = {
  ASSIGNMENT_SUBMITTED: 'ASSIGNMENT_SUBMITTED',
  ASSIGNMENT_GRADED: 'ASSIGNMENT_GRADED',
  EXAM_SUBMITTED: 'EXAM_SUBMITTED',
  CURRICULUM_UPDATED: 'CURRICULUM_UPDATED',
  MATERIAL_ADDED: 'MATERIAL_ADDED',
  REVIEW_ADDED: 'REVIEW_ADDED',
  BATCH_UPDATED: 'BATCH_UPDATED',
  REFERRAL_UPDATED: 'REFERRAL_UPDATED',
} as const;
