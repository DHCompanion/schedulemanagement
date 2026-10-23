-- Where the original uploaded file lives in private storage. Null for imports
-- made before files were kept, and for synthetic (split) imports.
ALTER TABLE "ScheduleImport" ADD COLUMN "sourceObjectKey" TEXT;
