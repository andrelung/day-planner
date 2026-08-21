-- CreateTable
CREATE TABLE "IgnoredEventTitle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredEventTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredEventTitle_userId_title_key" ON "IgnoredEventTitle"("userId", "title");

-- AddForeignKey
ALTER TABLE "IgnoredEventTitle" ADD CONSTRAINT "IgnoredEventTitle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
