-- AlterTable
ALTER TABLE "CalendarEventLink" ADD COLUMN     "ignored" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "linkedAsanaTaskGid" DROP NOT NULL,
ALTER COLUMN "linkedTaskName" DROP NOT NULL;
