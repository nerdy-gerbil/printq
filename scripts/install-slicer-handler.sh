#!/usr/bin/env bash
#
# Register the slicer bridges as handlers for `printq://` and
# `printq-anycubic://` links on this Linux desktop, and lay down the one
# config file both of them read.
#
# Run it once, on the machine that has the printer and your slicer(s):
#   ./scripts/install-slicer-handler.sh
#
# What it does, all under your own home directory — nothing system-wide, no
# sudo:
#   1. copies prusa-open.sh to ~/.local/bin/printq-prusa and anycubic-open.sh
#      to ~/.local/bin/printq-anycubic, and writes a .desktop entry for each
#      into ~/.local/share/applications pointing at *those copies*;
#   2. makes each the default handler for its scheme
#      (x-scheme-handler/printq and x-scheme-handler/printq-anycubic);
#   3. creates ~/.config/printq/slicer.conf (mode 600) for you to fill in, if
#      it is not already there. Both bridges read the same file.
#
# Neither slicer has to be installed for this to run cleanly — only clicking
# the matching button in the app ever invokes a handler, and a missing slicer
# fails loudly there, with a notification, not silently here.
#
# macOS and Windows register a scheme differently (a .app/Info.plist and a
# registry key respectively) — docs/prusaslicer.md has both. This installer is
# Linux/XDG only, and says so rather than pretending to work elsewhere.

set -euo pipefail

case "$(uname -s)" in
  Linux) : ;;
  *) echo "This installer is Linux/XDG only. See docs/prusaslicer.md for macOS and Windows." >&2
     exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
prusa_source="$here/prusa-open.sh"
anycubic_source="$here/anycubic-open.sh"
[ -f "$prusa_source" ] || { echo "prusa-open.sh is not beside this installer ($prusa_source)" >&2; exit 1; }
[ -f "$anycubic_source" ] || { echo "anycubic-open.sh is not beside this installer ($anycubic_source)" >&2; exit 1; }

# Install a COPY, and point the .desktop at that rather than at the checkout.
#
# The entry used to name the script where it sits in the working tree, which
# quietly made the button depend on which branch happened to be checked out:
# switch to anything cut before the handler landed and the file is gone, the
# click does nothing, and nothing anywhere says why. That is not hypothetical —
# it has bitten twice.
#
# A copy costs one `cp` and severs the dependency entirely. It is overwritten
# on every run, so re-running after a `git pull` is how you update the
# helpers — and the closing message says so.
bin_dir="$HOME/.local/bin"
prusa_handler="$bin_dir/printq-prusa"
anycubic_handler="$bin_dir/printq-anycubic"
mkdir -p "$bin_dir"
cp "$prusa_source" "$prusa_handler"
chmod +x "$prusa_handler"
echo "installed $prusa_handler"
cp "$anycubic_source" "$anycubic_handler"
chmod +x "$anycubic_handler"
echo "installed $anycubic_handler"

apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
prusa_desktop="$apps_dir/printq-prusa.desktop"
anycubic_desktop="$apps_dir/printq-anycubic.desktop"
mkdir -p "$apps_dir"

# %u is the clicked URL, passed through to the handler as its one argument.
cat >"$prusa_desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=PrintQ → PrusaSlicer
Comment=Open a printq:// model link in PrusaSlicer
Exec=$prusa_handler %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/printq;
DESKTOP
echo "wrote $prusa_desktop"

cat >"$anycubic_desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=PrintQ → Anycubic Slicer Next (FDM)
Comment=Open a printq-anycubic:// model link in Anycubic Slicer Next
Exec=$anycubic_handler %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/printq-anycubic;
DESKTOP
echo "wrote $anycubic_desktop"

# Make each the default for its scheme. xdg-mime is the portable way; if it is
# absent, fall back to editing mimeapps.list directly so this still works on a
# minimal install.
register() {
  local desktop="$1" scheme="$2"
  if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default "$desktop" "$scheme"
    echo "registered $scheme via xdg-mime"
  else
    local mimeapps="${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list"
    touch "$mimeapps"
    if ! grep -q "^$scheme=" "$mimeapps" 2>/dev/null; then
      grep -q '^\[Default Applications\]' "$mimeapps" 2>/dev/null || printf '[Default Applications]\n' >>"$mimeapps"
      tmp="$(mktemp)"
      awk -v s="$scheme" -v d="$desktop" '/^\[Default Applications\]/ { print; print s"="d; next } { print }' \
        "$mimeapps" >"$tmp" && mv "$tmp" "$mimeapps"
    fi
    echo "registered $scheme in $mimeapps (xdg-mime not found)"
  fi
}
register printq-prusa.desktop x-scheme-handler/printq
register printq-anycubic.desktop x-scheme-handler/printq-anycubic

command -v update-desktop-database >/dev/null 2>&1 &&
  update-desktop-database "$apps_dir" 2>/dev/null || true

# Config skeleton — never overwrite an existing one. Still created 600: it holds
# no credential any more, but an existing file might, and tightening is free.
conf_dir="${XDG_CONFIG_HOME:-$HOME/.config}/printq"
conf="$conf_dir/slicer.conf"
mkdir -p "$conf_dir"
if [ -f "$conf" ]; then
  echo "left your existing config alone: $conf"
else
  umask 077
  cat >"$conf" <<'CONF'
# PrintQ → slicer bridge config. Read by prusa-open.sh AND anycubic-open.sh —
# one instance, one config, however many slicers you use.
#
# There is nothing secret in here. The clicked link carries its own credential
# — minted by the app for whoever was looking at that ticket, good for half an
# hour and for that one model — so the only thing this file has to say is which
# instance to talk to.

# The instance, no trailing slash. This is the only required setting.
PRINTQ_BASE="https://print.example"

# Optional. Left unset, the Prusa helper finds PrusaSlicer on its own — a
# binary on PATH (prusa-slicer / prusaslicer / PrusaSlicer), a Flatpak, or an
# AppImage in ~/Applications, ~/Downloads or ~/.local/bin. Set it only to point
# somewhere else, in any of these forms:
#   PRINTQ_SLICER="prusa-slicer"                              # a binary name
#   PRINTQ_SLICER="$HOME/Applications/PrusaSlicer-2.9.0.AppImage"  # an AppImage
#   PRINTQ_SLICER="flatpak run com.prusa3d.PrusaSlicer"      # a Flatpak
#   PRINTQ_SLICER="orca-slicer"                              # any slicer works
# (A path containing spaces is the one form this cannot express.)

# Optional. Same story for Anycubic Slicer Next (FDM): the helper probes
# anycubic-slicer-next / AnycubicSlicerNext on PATH, a Flatpak, and an
# AppImage before giving up.
#   PRINTQ_ANYCUBIC_SLICER="$HOME/Applications/AnycubicSlicerNext-x86_64.AppImage"
#   PRINTQ_ANYCUBIC_SLICER="flatpak run com.anycubic.AnycubicSlicerNext"

# Optional. Where fetched models are cached (pruned after a day). Shared by
# both bridges.
# PRINTQ_DOWNLOAD_DIR="$HOME/.cache/printq/models"
CONF
  chmod 600 "$conf"
  echo "created $conf — set PRINTQ_BASE to your instance"
fi

echo
echo "Done. Set PRINTQ_BASE in $conf, then click 'Open in PrusaSlicer' or"
echo "'Open in Anycubic Slicer Next (FDM)' on any ticket. No token to paste —"
echo "the link carries its own."
echo
echo "The helpers are copies under $bin_dir, so the buttons do not care which"
echo "branch this checkout is on. After a git pull, re-run this installer to"
echo "update them."
if [ -f "$conf" ] && grep -q '^[[:space:]]*PRINTQ_TOKEN=' "$conf" 2>/dev/null; then
  echo
  echo "NOTE: $conf still sets PRINTQ_TOKEN. That was the old way in and it is a"
  echo "      long-lived credential on disk; links carry their own now. You can"
  echo "      delete the line."
fi
echo "Trouble? tail -f \"\${XDG_STATE_HOME:-\$HOME/.local/state}/printq/slicer.log\""
