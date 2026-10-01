/**
 * Seeds the owner-managed catalogues — the default benefits, materials and
 * cost rates.
 *
 * The administrator is NOT seeded. The first admin is created through the
 * first-run /setup page, which whoever deploys the app opens once; there are
 * no ADMIN_EMAIL / ADMIN_NAME variables to set. (A password in `.env.docker`
 * was never acceptable either — it lives in `docker inspect`, in the shell
 * history that wrote the file, and in every backup of the host — and the
 * set-password link the seed used to print was one more moving part.)
 *
 * Idempotent and non-destructive: an upsert per row with an empty update, so
 * a re-run (the migrator runs the seed on every deploy) never overwrites the
 * owner's edits — a renamed, retired or repriced row is left exactly as they
 * set it, and a retired default is not resurrected. New defaults are appended.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // The default benefits (tip options).
  const DEFAULT_BENEFITS = [
    "A beer",
    "A coffee",
    "A spool of filament",
    "Nerd stuff",
    "Nothing, sorry",
  ];
  for (let i = 0; i < DEFAULT_BENEFITS.length; i++) {
    await db.benefit.upsert({
      where: { label: DEFAULT_BENEFITS[i]! },
      update: {},
      create: { label: DEFAULT_BENEFITS[i]!, sortOrder: i + 1 },
    });
  }
  console.info(`Benefits ready: ${DEFAULT_BENEFITS.length} default tip(s) present.`);

  // The default materials. Same shape as benefits above.
  const DEFAULT_MATERIALS = ["PLA", "PETG", "TPU", "Resin"];
  for (let i = 0; i < DEFAULT_MATERIALS.length; i++) {
    await db.material.upsert({
      where: { name: DEFAULT_MATERIALS[i]! },
      update: {},
      create: { name: DEFAULT_MATERIALS[i]!, sortOrder: i + 1 },
    });
  }
  console.info(
    `Materials ready: ${DEFAULT_MATERIALS.length} default material(s) present.`,
  );

  // The default cost-calculator rates. Idempotent per-key upserts, same shape
  // as benefits: a re-run never overwrites a price the owner already changed.
  const DEFAULT_MATERIAL_RATES: Record<string, number> = {
    PLA: 20.0,
    PETG: 22.0,
    TPU: 28.0,
    Resin: 45.0,
  };
  for (const [material, dollarsPerKg] of Object.entries(DEFAULT_MATERIAL_RATES)) {
    await db.materialRate.upsert({
      where: { material },
      update: {},
      create: { material, dollarsPerKg },
    });
  }
  await db.machineRate.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", dollarsPerHour: 0.75 },
  });
  console.info("Cost calculator rates ready (edit them at /admin/rates).");

  console.info("No administrator is seeded — open /setup once to claim the printer.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
