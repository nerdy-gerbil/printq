import Link from "next/link";

/**
 * The tabs across the settings screen.
 *
 * One list, imported by every tab, because the alternative is four pages that
 * each know the other three — and the screen this replaces had grown exactly
 * that: rates on one page, the price per kilogram for a material on another,
 * and a note on each saying where the other was. A material and its colour
 * list and its price are one subject, so they sit under one roof and next to
 * each other, which is also why `/admin/materials` and `/admin/rates` now
 * redirect here rather than being deleted.
 *
 * Links rather than client-side tab state: every tab is a real URL, so one can
 * be bookmarked, opened in a second window, or reached with JavaScript off —
 * the same rule as the rest of the admin surfaces.
 */
export const SETTINGS_TABS = [
  { id: "general", label: "General", href: "/admin/settings" },
  { id: "materials", label: "Materials", href: "/admin/settings/materials" },
  { id: "colors", label: "Colours", href: "/admin/settings/colors" },
  { id: "rates", label: "Rates", href: "/admin/settings/rates" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function SettingsTabs({ active }: { active: SettingsTabId }) {
  return (
    <nav
      aria-label="Settings sections"
      className="mb-[22px] flex flex-wrap items-center gap-[6px] border-b-2 border-dashed border-rule pb-[13.2px]"
    >
      {SETTINGS_TABS.map((tab) => {
        const current = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-chip border-[3px] px-[15px] py-[7px] font-mono text-[12.5px] font-bold uppercase tracking-[0.08em] transition-colors ${
              current
                ? "border-ink bg-sun text-ink"
                : "border-transparent text-ink-2 hover:border-ink hover:bg-cream-2 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
