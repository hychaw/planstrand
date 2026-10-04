ALTER TABLE "operations" ADD COLUMN "required_entity_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
