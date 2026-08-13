-- A holiday now carries a list of festival names rather than one, since
-- festivals coincide (Diwali / Govardhan Puja) and the day must stay a single
-- row so "is the office open" has one answer.
--
-- Hand-written rather than left as Prisma's generated DROP + ADD: that form
-- discards every existing name. This converts them instead. The resulting
-- column shape is identical, so the schema stays in sync.

-- 1. Add the new column, nullable for the moment.
ALTER TABLE "Holiday" ADD COLUMN "names" TEXT[];

-- 2. Carry each existing name across as a single-element array.
UPDATE "Holiday" SET "names" = ARRAY["name"] WHERE "name" IS NOT NULL;

-- 3. Drop the old column now that nothing depends on it.
ALTER TABLE "Holiday" DROP COLUMN "name";
