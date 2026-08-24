-- AlterTable
ALTER TABLE "OAuthAccount" ADD COLUMN     "workspacesCachedAt" TIMESTAMP(3),
ADD COLUMN     "workspacesJson" JSONB;
