import { printerName, requireUser } from "@/lib/authz";
import { listActiveBenefits } from "@/lib/benefits";
import { activePalettes } from "@/lib/colors";
import { machineRate } from "@/lib/cost";
import { listActiveMaterials } from "@/lib/materials";
import { getSettings } from "@/lib/settings";
import { AppHeader } from "@/components/app-header";
import { Kicker, Notice } from "@/components/ui";
import { UploadForm, type EstimateBasis } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const user = await requireUser("/upload");
  const owner = await printerName();
  const settings = await getSettings();
  // The tip options are owner-managed now; the form renders from these.
  const benefits = (await listActiveBenefits()).map((b) => ({
    label: b.label,
    preferred: b.preferred,
  }));
  const [materials, palettes, dollarsPerHour] = await Promise.all([
    listActiveMaterials(),
    // Colours belong to a material, so the form needs every material's list and
    // swaps between them itself — see the Colours tab on the settings screen.
    activePalettes(),
    machineRate(),
  ]);
  const materialNames = materials.map((m) => m.name);

  /*
   * What the form prices a file from. The file has not been sent when the price
   * appears, so this arithmetic runs in the browser and needs the shop's own
   * numbers handed to it — the same rate rows the ledger reads once the print
   * is real, so an estimate and the real figure can never be worked out from
   * two different prices.
   */
  const basis: EstimateBasis = {
    currency: settings.currency,
    infillPercent: settings.assumedInfillPercent,
    flowMm3s: settings.estimateFlowMm3s,
    dollarsPerHour,
    markupPercent: settings.markupPercent,
    minimumCharge: settings.minimumCharge,
    materials: Object.fromEntries(
      materials.map((m) => [
        m.name,
        { dollarsPerKg: m.dollarsPerKg ?? 0, densityGcm3: m.densityGcm3 },
      ]),
    ),
  };

  return (
    <>
      <AppHeader user={user} active="/upload" />
      <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <div className="max-w-[780px]">
          <Kicker>New order</Kicker>
          {/* The order counter's ask, kept as a sentence someone would say. */}
          <h1 className="m-0 mb-[13.2px] text-[46px] leading-[0.98] text-ink">
            Put it on the queue
          </h1>
          <p className="m-0 mb-[26.4px] text-[16.5px] leading-[1.5] text-ink-2 text-pretty">
            Drop an <span className="font-mono">.stl</span> or{" "}
            <span className="font-mono">.3mf</span>. {owner} gets a ping, and
            your order goes up on the rail as a ticket you can follow.
          </p>
        </div>
        {/*
          The owner's switch, and theirs to word: while orders are paused the
          form is not rendered at all, so there is nothing to fill in and
          nothing to lose. The route refuses the same way, which is what makes
          this a rule rather than a hidden control.
        */}
        {settings.ordersPaused ? (
          <div className="max-w-[620px]">
            <Notice tone="warn">
              {settings.pausedMessage.trim() ||
                `${owner} is not taking new requests just now. Anything already on the rail keeps moving — ask the team directly if it is urgent.`}
            </Notice>
          </div>
        ) : (
          <UploadForm
            owner={owner}
            benefits={benefits}
            materialNames={materialNames}
            palettes={palettes}
            basis={basis}
            defaultMaterial={settings.defaultMaterial}
            maxBytes={settings.maxUploadMb * 1024 * 1024}
          />
        )}
      </main>
    </>
  );
}
