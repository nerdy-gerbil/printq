/**
 * Seeds the owner-managed catalogues — the default benefits, materials, the
 * colours each material is offered in, and the cost rates.
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

  // The default materials, each with the filament density that turns a mesh
  // volume into grams. Same shape as benefits above, and `update` is empty for
  // the same reason: a re-run fills in what is missing and never overwrites a
  // density the owner has since corrected against a real spool.
  const DEFAULT_MATERIALS = [
    { name: "PLA", densityGcm3: 1.24 },
    { name: "PETG", densityGcm3: 1.27 },
    { name: "TPU", densityGcm3: 1.21 },
    { name: "Resin", densityGcm3: 1.1 },
  ];
  for (let i = 0; i < DEFAULT_MATERIALS.length; i++) {
    const material = DEFAULT_MATERIALS[i]!;
    await db.material.upsert({
      where: { name: material.name },
      update: {},
      create: { name: material.name, densityGcm3: material.densityGcm3, sortOrder: i + 1 },
    });
  }
  console.info(
    `Materials ready: ${DEFAULT_MATERIALS.length} default material(s) present.`,
  );
  console.info(
    `Densities ready: ${DEFAULT_MATERIALS.map((m) => `${m.name} ${m.densityGcm3}`).join(", ")} g/cm³ (editable at /admin/settings).`,
  );

  // The built-in filament swatches, per material. Same idempotent shape as the
  // two catalogues above, so a re-run fills gaps and leaves the owner's own
  // colours — renamed, recoloured or retired — exactly as they left them.
  const DEFAULT_COLORS = [
    { name: "Teal", hex: "#12645f" },
    { name: "Slate", hex: "#4a5d78" },
    { name: "Bone white", hex: "#eaecee" },
    { name: "Graphite", hex: "#1b2126" },
    { name: "Whatever's on", hex: "#b6bcc2" },
  ];
  for (const { name: material } of DEFAULT_MATERIALS) {
    for (let i = 0; i < DEFAULT_COLORS.length; i++) {
      const color = DEFAULT_COLORS[i]!;
      await db.materialColor.upsert({
        where: { material_name: { material, name: color.name } },
        update: {},
        create: { material, name: color.name, hex: color.hex, sortOrder: i + 1 },
      });
    }
  }
  console.info(
    `Colours ready: ${DEFAULT_COLORS.length} swatch(es) per material, editable at /admin/settings.`,
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
  console.info("Cost calculator rates ready (edit them at /admin/settings).");

  console.info("No administrator is seeded — open /setup once to claim the printer.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
