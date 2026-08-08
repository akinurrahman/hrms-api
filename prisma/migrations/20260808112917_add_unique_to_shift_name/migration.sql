/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Shift` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Shift_name_key" ON "Shift"("name");
