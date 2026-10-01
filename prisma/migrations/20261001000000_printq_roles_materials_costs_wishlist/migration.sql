-- PrintQ: three access levels, owner-managed materials, cost inputs,
-- multi-colour, source links, and the wishlist.
--
-- Written by hand to keep the story coherent in one pass; destructive only
-- where the old world has to end (the single-admin index, the Material enum).
--
-- Order matters in three places, noted inline.

-- ===========================================================================
-- 1. Roles — user / manager / admin
-- ===========================================================================

-- The single-admin guarantee is intentionally dropped: PrintQ allows any
-- number of admins and adds `manager` between them and users.
DROP INDEX IF EXISTS "user_single_admin";

-- Postgres 12+ allows ADD VALUE inside a transaction, provided the new value
-- is not used by the same transaction. Nothing below writes a manager row.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'manager';

-- `client` reads wrong next to `manager`. RENAME rewrites the label in place:
-- existing rows keep resolving, no table rewrite, no data migration.
ALTER TYPE "Role" RENAME VALUE 'client' TO 'user';

ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'user';
ALTER TABLE "invite" ALTER COLUMN "role" SET DEFAULT 'user';

-- ===========================================================================
-- 2. Cost inputs — actual grams and minutes, plus the rate tables
-- ===========================================================================

ALTER TABLE "story" ADD COLUMN "weightGrams" INTEGER;
ALTER TABLE "story" ADD COLUMN "printMinutes" INTEGER;

-- `material_rate.material` is a plain string from birth — not a foreign key —
-- so a rate keeps working when a material is later renamed or retired.
CREATE TABLE "material_rate" (
    "material" TEXT NOT NULL,
    "dollarsPerKg" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_rate_pkey" PRIMARY KEY ("material")
);

CREATE TABLE "machine_rate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "dollarsPerHour" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_rate_pkey" PRIMARY KEY ("id")
);

-- Seed sane defaults so the calculator works before the owner ever visits
-- /admin/rates. Typical consumer filament prices; every one editable.
INSERT INTO "material_rate" ("material", "dollarsPerKg", "updatedAt") VALUES
    ('PLA', 20.0, CURRENT_TIMESTAMP),
    ('PETG', 22.0, CURRENT_TIMESTAMP),
    ('TPU', 28.0, CURRENT_TIMESTAMP),
    ('Resin', 45.0, CURRENT_TIMESTAMP);

INSERT INTO "machine_rate" ("id", "dollarsPerHour", "updatedAt") VALUES
    ('default', 0.75, CURRENT_TIMESTAMP);

-- ===========================================================================
-- 3. Multi-colour printing
-- ===========================================================================

ALTER TABLE "story" ADD COLUMN "additionalColorNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ===========================================================================
-- 4. Materials become owner-managed data
-- ===========================================================================

-- Mirrors `benefit`'s shape. Seeded with the four the app always shipped
-- with, so an existing deployment sees no change in the upload form until
-- the owner edits the list.
CREATE TABLE "material" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_name_key" ON "material"("name");
CREATE INDEX "material_active_sortOrder_idx" ON "material"("active", "sortOrder");

INSERT INTO "material" ("id", "name", "sortOrder", "updatedAt") VALUES
    ('mat_pla', 'PLA', 1, CURRENT_TIMESTAMP),
    ('mat_petg', 'PETG', 2, CURRENT_TIMESTAMP),
    ('mat_tpu', 'TPU', 3, CURRENT_TIMESTAMP),
    ('mat_resin', 'Resin', 4, CURRENT_TIMESTAMP);

-- `story.material` moves from the enum to TEXT. Enum values are their own
-- string form, so USING casts losslessly.
ALTER TABLE "story" ALTER COLUMN "material" DROP DEFAULT;
ALTER TABLE "story" ALTER COLUMN "material" TYPE TEXT USING "material"::TEXT;
ALTER TABLE "story" ALTER COLUMN "material" SET DEFAULT 'PETG';

-- No column references the type any more; drop it.
DROP TYPE "Material";

-- ===========================================================================
-- 5. Source links on tickets
-- ===========================================================================

ALTER TABLE "story" ADD COLUMN "sourceUrl" TEXT;

-- ===========================================================================
-- 6. Wishlist
-- ===========================================================================

CREATE TABLE "wishlistItem" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "source" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wishlistItem_url_key" ON "wishlistItem"("url");
CREATE INDEX "wishlistItem_createdAt_idx" ON "wishlistItem"("createdAt");
CREATE INDEX "wishlistItem_addedById_idx" ON "wishlistItem"("addedById");

ALTER TABLE "wishlistItem" ADD CONSTRAINT "wishlistItem_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
