-- CreateTable
CREATE TABLE "video_agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encoder" TEXT,
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL DEFAULT 0,
    "uploadSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "encoder" TEXT,
    "rungs" TEXT,
    "segmentCount" INTEGER,
    "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_agents_tokenHash_key" ON "video_agents"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "video_jobs_videoId_key" ON "video_jobs"("videoId");

-- CreateIndex
CREATE INDEX "video_jobs_agentId_status_idx" ON "video_jobs"("agentId", "status");

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "video_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
