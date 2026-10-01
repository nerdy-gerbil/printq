#!/usr/bin/env bash
#
# printq → Anycubic Slicer Next (FDM) bridge. Handles a
# `printq-anycubic://slice/<id>` link by fetching the model from a PrintQ
# - Requests instance and opening it in a local Anycubic Slicer Next.
#
# Runs ON THE PERSON'S OWN MACHINE — the same shape as scripts/prusa-open.sh,
# and for the same reason: Anycubic Slicer Next is built from OrcaSlicer, but
# the app's model-download deep links are wired to Makeronline's own CDN, not
# to a scheme a self-hosted host can join. So instead of asking the slicer to
# fetch, this script fetches the bytes itself and hands the slicer a *local
# file*, which has no domain to check.
#
# This file is deliberately a near-duplicate of prusa-open.sh rather than a
# shared library the two source: they are invoked as two different desktop
# handlers for two different URL schemes, each copied to ~/.local/bin on
# install (see install-slicer-handler.sh) for the same "a copy never goes
# stale under your feet" reason prusa-open.sh documents. A shared library
# would need its own install/versioning story to get the same guarantee, for
# maybe forty lines saved.
#
# Config lives at $PRINTQ_SLICER_CONF (default ~/.config/printq/slicer.conf) —
# the SAME file prusa-open.sh reads, since both bridges belong to the same
# app instance:
#   PRINTQ_BASE             the instance, e.g. https://print.example (required)
#   PRINTQ_ANYCUBIC_SLICER  the Anycubic Slicer Next command (default: probe)
#   PRINTQ_DOWNLOAD_DIR     where fetched models land (default:
#                           ~/.cache/printq/models, shared with the Prusa
#                           bridge)
#
# The clicked link carries its own credential, exactly like the Prusa one:
# `printq-anycubic://slice/<id>?t=<token>`, minted for the person looking at
# that ticket, good for half an hour and for that model only. Nothing secret
# is ever written to disk.

set -euo pipefail

CONF="${PRINTQ_SLICER_CONF:-$HOME/.config/printq/slicer.conf}"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/printq"
LOG="$LOG_DIR/slicer.log"
mkdir -p "$LOG_DIR"

# --- loud failure -----------------------------------------------------------
# A protocol handler has no terminal: log it, and pop a desktop notification
# where one exists. A click that silently does nothing is indistinguishable
# from "not installed", which is the worst possible outcome.
note() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG"
}
fail() {
  note "ERROR (anycubic): $1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -u critical "Open in Anycubic Slicer Next failed" "$1" || true
  fi
  printf 'anycubic-open: %s\n' "$1" >&2
  exit 1
}

# --- config -----------------------------------------------------------------
[ -f "$CONF" ] || fail "no config at $CONF — run install-slicer-handler.sh first"

# shellcheck disable=SC1090
. "$CONF"

: "${PRINTQ_BASE:?PRINTQ_BASE is not set in $CONF}"
DOWNLOAD_DIR="${PRINTQ_DOWNLOAD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/printq/models}"

# --- locate Anycubic Slicer Next --------------------------------------------
# Same three cases as the Prusa bridge: a binary on PATH (the Windows/Linux
# installers do not put one there, but a symlink or a Linux package might),
# a Flatpak, or an AppImage in the usual spots. PRINTQ_ANYCUBIC_SLICER may be
# any of those forms, or a multi-word command; it is split on whitespace.
if [ -n "${PRINTQ_ANYCUBIC_SLICER:-}" ]; then
  read -r -a SLICER_CMD <<<"$PRINTQ_ANYCUBIC_SLICER"
else
  SLICER_CMD=()
  for cand in anycubic-slicer-next anycubicslicernext AnycubicSlicerNext AnycubicSlicerNextG; do
    if command -v "$cand" >/dev/null 2>&1; then SLICER_CMD=("$cand"); break; fi
  done
  if [ "${#SLICER_CMD[@]}" -eq 0 ] && command -v flatpak >/dev/null 2>&1 &&
    flatpak info com.anycubic.AnycubicSlicerNext >/dev/null 2>&1; then
    SLICER_CMD=(flatpak run com.anycubic.AnycubicSlicerNext)
  fi
  if [ "${#SLICER_CMD[@]}" -eq 0 ]; then
    for g in \
      "$HOME"/Applications/*[Aa]nycubic*[Ss]licer*.AppImage \
      "$HOME"/Downloads/*[Aa]nycubic*[Ss]licer*.AppImage \
      "$HOME"/.local/bin/*[Aa]nycubic*[Ss]licer*.AppImage \
      /opt/*[Aa]nycubic*[Ss]licer*/*.AppImage; do
      [ -x "$g" ] && { SLICER_CMD=("$g"); break; }
    done
  fi
fi

[ "${#SLICER_CMD[@]}" -gt 0 ] || fail \
  "could not find Anycubic Slicer Next. Set PRINTQ_ANYCUBIC_SLICER in $CONF — a binary name, the full path to an AppImage, or the install directory's launcher."

# --- parse the link ---------------------------------------------------------
url="${1:-}"
[ -n "$url" ] || fail "no URL given — this is invoked by clicking a printq-anycubic:// link"

# The id is the ONLY thing taken from the URL, validated to digits before it
# ever reaches a request path; the token to the base64url alphabet plus its
# separating dot. Neither can smuggle anything into the fetch below.
rest="${url#printq-anycubic://slice/}"
id="${rest%%\?*}"
id="${id%/}"
case "$id" in
  "" | *[!0-9]*) fail "not a model link: $url (expected printq-anycubic://slice/<number>)" ;;
esac

link_token=""
if [ "$rest" != "${rest#*\?}" ]; then
  query="${rest#*\?}"
  case "$query" in
    *t=*)
      link_token="${query##*t=}"
      link_token="${link_token%%&*}"
      ;;
  esac
fi
case "$link_token" in
  "") fail "that link carries no credential — open the ticket in the app and click the button there" ;;
  *[!A-Za-z0-9._-]*) fail "the credential in that link is malformed — open the ticket again and re-click" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is not installed"
slicer_head="${SLICER_CMD[0]}"
command -v "$slicer_head" >/dev/null 2>&1 || [ -x "$slicer_head" ] ||
  fail "slicer '$slicer_head' is not runnable — fix PRINTQ_ANYCUBIC_SLICER in $CONF"

# --- fetch ------------------------------------------------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
hdr="$tmp/headers"
body="$tmp/body"

note "fetching story $id from $PRINTQ_BASE (anycubic)"
code="$(
  curl -sS -o "$body" -D "$hdr" -w '%{http_code}' \
    --get --data-urlencode "t=$link_token" \
    "$PRINTQ_BASE/api/models/$id" 2>"$tmp/err"
)" || fail "could not reach $PRINTQ_BASE: $(tr -d '\r' <"$tmp/err" | tail -n1)"

case "$code" in
  200) : ;;
  401) fail "that link has expired (HTTP 401). They last half an hour — open the ticket again and click the button." ;;
  404) fail "story $id is not there, or not one this account may see (HTTP 404)" ;;
  *)   fail "server returned HTTP $code for story $id" ;;
esac

name="$(
  grep -i '^content-disposition:' "$hdr" | tr -d '\r' |
    sed -n 's/.*filename="\([^"]*\)".*/\1/p' | head -n1
)"
name="$(basename "${name:-model-$id.stl}")"
# Spaces break some launchers' argument splitting, and only the local temp
# file's name is at stake — make it conservative.
name="$(printf '%s' "$name" | tr ' ' '_' | tr -cd 'A-Za-z0-9._-')"
case "$name" in "" | .*) name="model-$id.stl" ;; esac

mkdir -p "$DOWNLOAD_DIR"
# Prune anything older than a day so the cache cannot grow without bound.
find "$DOWNLOAD_DIR" -maxdepth 1 -type f -mtime +1 -delete 2>/dev/null || true

out="$DOWNLOAD_DIR/PrintQ-$((100 + id))-$name"
mv "$body" "$out"
note "saved $out"

# --- open -------------------------------------------------------------------
# Anycubic Slicer Next is Orca-based; Orca opens .stl/.3mf from the command
# line with the file as the argument. There is no documented
# --single-instance equivalent, so launch plainly.
note "opening with: ${SLICER_CMD[*]}"
setsid "${SLICER_CMD[@]}" "$out" >>"$LOG" 2>&1 &
note "handed off story $id to Anycubic Slicer Next"
