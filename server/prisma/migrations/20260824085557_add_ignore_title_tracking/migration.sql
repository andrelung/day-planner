-- AlterTable
ALTER TABLE "CalendarEventLink" ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "DeclinedAutoIgnoreTitle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclinedAutoIgnoreTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeclinedAutoIgnoreTitle_userId_title_key" ON "DeclinedAutoIgnoreTitle"("userId", "title");

-- AddForeignKey
ALTER TABLE "DeclinedAutoIgnoreTitle" ADD CONSTRAINT "DeclinedAutoIgnoreTitle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
