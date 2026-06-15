-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "claimed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "superPassword" TEXT;
