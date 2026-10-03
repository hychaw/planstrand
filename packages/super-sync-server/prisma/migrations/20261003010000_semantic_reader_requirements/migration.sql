ALTER TABLE "operations" ADD COLUMN "required_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
