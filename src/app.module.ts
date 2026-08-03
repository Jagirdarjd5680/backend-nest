import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SessionModule } from './session/session.module';
import { CoursesModule } from './courses/courses.module';
import { BatchesModule } from './batches/batches.module';
import { ChatModule } from './chat/chat.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MediaAccessModule } from './media-access/media-access.module';
import { LeavesModule } from './leaves/leaves.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { ExamsModule } from './exams/exams.module';
import { MediaModule } from './media/media.module';
import { AttendanceModule } from './attendance/attendance.module';
import { BannersModule } from './banners/banners.module';
import { BatchMaterialsModule } from './batch-materials/batch-materials.module';
import { BookingBatchesModule } from './booking-batches/booking-batches.module';
import { CategoriesModule } from './categories/categories.module';
import { CertificatesModule } from './certificates/certificates.module';
import { CourseProgressModule } from './course-progress/course-progress.module';
import { CreditTransactionsModule } from './credit-transactions/credit-transactions.module';
import { EventsModule } from './events/events.module';
import { EventBookingsModule } from './event-bookings/event-bookings.module';
import { ExamResultsModule } from './exam-results/exam-results.module';
import { ExamUnlocksModule } from './exam-unlocks/exam-unlocks.module';
import { FeeRecordsModule } from './fee-records/fee-records.module';
import { FreeMaterialsModule } from './free-materials/free-materials.module';
import { LiveClassesModule } from './live-classes/live-classes.module';
import { NewsTickerModule } from './news-ticker/news-ticker.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PassedStudentsModule } from './passed-students/passed-students.module';
import { PaymentsModule } from './payments/payments.module';
import { PlacementsModule } from './placements/placements.module';
import { QuestionsModule } from './questions/questions.module';
import { ReferralsModule } from './referrals/referrals.module';
import { ReferralJoinRequestsModule } from './referral-join-requests/referral-join-requests.module';
import { ResumesModule } from './resumes/resumes.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AppReviewsModule } from './app-reviews/app-reviews.module';
import { SeatBookingsModule } from './seat-bookings/seat-bookings.module';
import { SeatBookingAdminModule } from './seat-booking-admin/seat-booking-admin.module';
import { SettingsModule } from './settings/settings.module';
import { SupportSessionsModule } from './support-sessions/support-sessions.module';
import { TicketsModule } from './tickets/tickets.module';
import { TimetablesModule } from './timetables/timetables.module';
import { TutorsModule } from './tutors/tutors.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { WithdrawRequestsModule } from './withdraw-requests/withdraw-requests.module';
import { BlogsModule } from './blogs/blogs.module';
import { CouponsModule } from './coupons/coupons.module';
import { ParentModule } from './parent/parent.module';
import { ReportsModule } from './reports/reports.module';
import { SearchModule } from './search/search.module';
import { BackupModule } from './backup/backup.module';
import { GamificationModule } from './gamification/gamification.module';
import { UploadsModule } from './uploads/uploads.module';
import { QueuesModule } from './queues/queues.module';
import { GoogleReviewsModule } from './google-reviews/google-reviews.module';
import { VideoReviewsModule } from './video-reviews/video-reviews.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueuesModule,
    UsersModule,
    AuthModule,
    SessionModule,
    CoursesModule,
    BatchesModule,
    ChatModule,
    RealtimeModule,
    MediaAccessModule,
    LeavesModule,
    AssignmentsModule,
    ExamsModule,
    MediaModule,
    AttendanceModule,
    BannersModule,
    BatchMaterialsModule,
    BookingBatchesModule,
    CategoriesModule,
    CertificatesModule,
    CourseProgressModule,
    CreditTransactionsModule,
    EventsModule,
    EventBookingsModule,
    ExamResultsModule,
    ExamUnlocksModule,
    FeeRecordsModule,
    FreeMaterialsModule,
    LiveClassesModule,
    NewsTickerModule,
    NotificationsModule,
    PassedStudentsModule,
    PaymentsModule,
    PlacementsModule,
    QuestionsModule,
    ReferralsModule,
    ReferralJoinRequestsModule,
    ResumesModule,
    ReviewsModule,
    AppReviewsModule,
    SeatBookingsModule,
    SeatBookingAdminModule,
    SettingsModule,
    SupportSessionsModule,
    TicketsModule,
    TimetablesModule,
    TutorsModule,
    WithdrawalsModule,
    WithdrawRequestsModule,
    BlogsModule,
    CouponsModule,
    ParentModule,
    ReportsModule,
    SearchModule,
    BackupModule,
    GamificationModule,
    UploadsModule,
    GoogleReviewsModule,
    VideoReviewsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}


