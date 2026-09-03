-- Backfills as true for every Settings row that already exists: those users
-- necessarily got through onboarding on some device already (the flag lived
-- in that device's localStorage until now), so defaulting them to false
-- would show the workday-setup screen to the entire existing user base once
-- more. New rows created from here on get the schema default of false.
ALTER TABLE "Settings" ADD COLUMN     "hasOnboarded" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ALTER COLUMN "hasOnboarded" SET DEFAULT false;
