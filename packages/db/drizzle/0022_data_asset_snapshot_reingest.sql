ALTER TABLE "data_snapshots" ADD COLUMN "source_object_key" text;--> statement-breakpoint
DO $$
DECLARE
  ambiguous_asset_id uuid;
BEGIN
  SELECT a."id"
  INTO ambiguous_asset_id
  FROM "data_assets" a
  JOIN "data_snapshots" s ON s."asset_id" = a."id"
  GROUP BY a."id"
  HAVING count(*) <> 1
  LIMIT 1;

  IF ambiguous_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot uniquely backfill source object key for Data Asset %', ambiguous_asset_id;
  END IF;

  UPDATE "data_snapshots" s
  SET "source_object_key" = a."object_key"
  FROM "data_assets" a
  WHERE a."id" = s."asset_id";

  IF EXISTS (SELECT 1 FROM "data_snapshots" WHERE "source_object_key" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill source object key for every Data Snapshot';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "data_snapshots" ALTER COLUMN "source_object_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "data_assets" DROP COLUMN "object_key";
