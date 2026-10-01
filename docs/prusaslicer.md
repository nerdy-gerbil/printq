# Open in a slicer

[← back to the README](../README.md)

Every ticket has two hand-off controls: **Open in PrusaSlicer** and **Open in
Anycubic Slicer Next (FDM)**. Clicking one fetches the model and opens it in
that slicer on the machine you clicked from. This page is how to set the
bridges up once, and why they work the way they do.

## Why it is not a one-line deep link

Both slicers ship their own URL schemes — PrusaSlicer's
`prusaslicer://open?file=<url>`, and Anycubic Slicer Next (built from
OrcaSlicer) has an equivalent wired to Makeronline's own CDN. It would have
been two lines to emit either. They do not work here, and cannot be made to:

> PrusaSlicer only downloads from a **hardcoded allowlist**: `printables.com`,
> `thingiverse.com`, `cults3d.com`. There is no setting to add a domain. The
> requests to make it configurable were closed as *not planned*
> ([#13752](https://github.com/prusa3d/PrusaSlicer/issues/13752),
> [#14313](https://github.com/prusa3d/PrusaSlicer/issues/14313)); Prusa adds
> domains one at a time after a security review, on request.

A self-hosted instance on your own hostname can never be on that list, and
Anycubic's scheme has the same shape of problem with a different hostname. And
the allowlist is checked against the **URL string** the slicer is handed,
before it makes any request — so there is no header on any request to us that
could be set to look like Printables. (Trying to disguise the URL to slip past
the check is a parser-confusion trick: brittle, it breaks the next time the
check is tightened, and it re-opens for you the exact hole the allowlist exists
to close.)

So the model is fetched by **a small helper on your own machine**, which hands
the slicer a **local file**. A local file has no domain to check, so the
allowlist never applies — that is the design, not a loophole. The helper is the
only new moving part, and it talks to nothing but this app's own API.

```
 Browser                 Helper on your machine            This app
 ───────                 ──────────────────────            ────────
 click ─printq://slice/104?t=…─▶ prusa-open.sh
        ─printq-anycubic://slice/104?t=…─▶ anycubic-open.sh
                            GET /api/models/104?t=…  ───────▶  (link credential)
                            ◀───────────────────── the .stl bytes
                            writes /tmp/…/PrintQ-104-clip.stl
                            <the slicer> <that file>
```

## Setup (Linux)

On the machine with the printer, the slicer(s) and your browser, from a
checkout of this repo:

```bash
./scripts/install-slicer-handler.sh
```

That installs **both** bridges, and lays down three things:

1. Copies [`scripts/prusa-open.sh`](../scripts/prusa-open.sh) to
   `~/.local/bin/printq-prusa` and [`scripts/anycubic-open.sh`](../scripts/anycubic-open.sh)
   to `~/.local/bin/printq-anycubic`, with a `.desktop` entry for each.
2. Registers `printq://` and `printq-anycubic://` links to open with those
   **copies**.
3. Creates `~/.config/printq/slicer.conf` (mode 600) for you to fill in —
   **one file both bridges read**, since both belong to the same app instance:

```sh
PRINTQ_BASE="https://print.example"     # your instance, no trailing slash
# PRINTQ_SLICER=…                        # PrusaSlicer, only if auto-detect misses
# PRINTQ_ANYCUBIC_SLICER=…               # Anycubic Slicer Next, only if auto-detect misses
# PRINTQ_DOWNLOAD_DIR="$HOME/.cache/printq/models"
```

Set the base address, and whichever slicer buttons you actually use will work.
The other bridge simply fails its own detection until configured, and tells you
so — installing both costs nothing.

That is the whole config: **there is no token to paste.** The clicked link
carries its own credential.

### Why a copy, and what to do after a `git pull`

The handlers are installed as **copies** under `~/.local/bin`, and the
`.desktop` entries point there rather than into this checkout.

They used to point at `scripts/prusa-open.sh` where it sits in the working
tree, which quietly made the button depend on which branch was checked out.
Check out anything cut before the handler landed and the file is simply gone:
the click does nothing, and nothing anywhere says why. That is the worst
failure mode this whole helper is written to avoid, and it bit twice before the
copy went in.

The trade is that the copies do not update themselves. **After pulling
changes, re-run the installer** — it overwrites the copies, and that is the
only step:

```bash
git pull && ./scripts/install-slicer-handler.sh
```

Running it again is safe at any time. It leaves an existing `slicer.conf`
alone.

### Finding the slicers

Left unset, each helper probes the places its slicer usually is:

- **PrusaSlicer:** a binary on `PATH` (`prusa-slicer`, `prusaslicer`,
  `PrusaSlicer`), a Flatpak install, then an AppImage in `~/Applications`,
  `~/Downloads` or `~/.local/bin`. On most machines that just works — including
  a Flathub install, which nothing puts on `PATH`.
- **Anycubic Slicer Next:** the same ladder with its own names
  (`anycubic-slicer-next`, `AnycubicSlicerNext`, `AnycubicSlicerNextG`), the
  Flatpak `com.anycubic.AnycubicSlicerNext`, then any
  `*[Aa]nycubic*[Ss]licer*.AppImage`.

Set `PRINTQ_SLICER` / `PRINTQ_ANYCUBIC_SLICER` only when detection misses, in
whichever form matches your install:

```sh
PRINTQ_SLICER="prusa-slicer"                             # a binary name
PRINTQ_SLICER="$HOME/Applications/PrusaSlicer-2.9.0.AppImage"  # an AppImage
PRINTQ_SLICER="flatpak run com.prusa3d.PrusaSlicer"      # a Flatpak

PRINTQ_ANYCUBIC_SLICER="$HOME/AnycubicSlicerNext/AnycubicSlicerNext"  # a launcher
PRINTQ_ANYCUBIC_SLICER="flatpak run com.anycubic.AnycubicSlicerNext"
```

A multi-word command (the Flatpak form) is split on spaces and run as-is, so a
path that itself contains spaces is the one thing this cannot express — put the
executable somewhere without them.

**Flatpak note:** the slicer must be allowed to read the downloaded file. The
default `PRINTQ_DOWNLOAD_DIR` is under `~/.cache`, which a Flatpak with home
access can see; if yours is sandboxed tighter, grant it with
`flatpak override --user --filesystem=xdg-cache/printq com.prusa3d.PrusaSlicer`.

### The credential is in the link

Click either button on any ticket and it works. The link is
`printq://slice/<id>?t=<token>` (or `printq-anycubic://…`), and that token is
minted by the app when the ticket is rendered — for **you**, for **that
model**, for **half an hour**.

It is deliberately not much of a secret, because it cannot do much: it names
who you are, and the server decides the rest. Your account is loaded and
refused if it has been suspended, and the same `storyScope` rule the pages use
is re-applied — so a link cannot reach a model you have lost access to, and
cannot be edited to fetch a different one. If it expires, open the ticket again
and click; there is nothing to rotate.

Two consequences worth stating plainly:

- **Nothing secret is on your disk.** `slicer.conf` holds an address. It is
  still created `600`, but there is nothing in it to steal.
- **Signing out does not kill an outstanding link.** Nothing is stored, so
  there is nothing to revoke — the half hour has to elapse. Suspending the
  account *does* stop it. For read access to one model you could already open,
  that is the right side of the trade.

#### If you set this up before

Earlier versions put a `PPP_TOKEN` in that file — a bearer token, which is the
session token. When sessions came down from thirty days to twenty idle minutes
it stopped working, and every click began answering `HTTP 401`. That is the bug
this replaced. It survives here only as the renamed, deprecated `PRINTQ_TOKEN`
fallback for old bookmarks; there is no reason to keep one:

```bash
sed -i '/^PRINTQ_TOKEN=/d' ~/.config/printq/slicer.conf
```

### Just want the file?

Every ticket also has a plain **Download** button next to these. Same bytes,
same permissions, no helper and no setup — for a machine without either
bridge, or a slicer that is neither.

## When it does not work

A scheme link with no handler installed does **nothing** — that is the browser,
not a bug, and it is why the buttons say as much. Everything the helpers do,
and every refusal, is logged:

```bash
tail -f "${XDG_STATE_HOME:-$HOME/.local/state}/printq/slicer.log"
```

Failures also raise a desktop notification where `notify-send` exists, because
a protocol handler has no terminal and a click that silently fails is
indistinguishable from one that was never wired up. Common lines:

| It says | Means |
| --- | --- |
| `no config at …` | The installer has not run, or `$PRINTQ_SLICER_CONF` points elsewhere. |
| nothing at all happens, no log line | The handler is not where the `.desktop` says. If you set this up before the copy landed, it still points into the checkout — re-run the installer. |
| `that link has expired (HTTP 401)` | Links last half an hour. Open the ticket again and click the button. |
| `that link carries no credential and … sets no PRINTQ_TOKEN` | An old bookmark, on a config with no token. Open the ticket in the app and click there. |
| `the credential in that link is malformed` | The URL was edited or truncated in transit. Re-click from the ticket. |
| `story N … not one this account may see (HTTP 404)` | That ticket is not yours, or does not exist. |
| `could not find PrusaSlicer` / `could not find Anycubic Slicer Next` | Auto-detect missed it. Set `PRINTQ_SLICER` / `PRINTQ_ANYCUBIC_SLICER` — see *Finding the slicers* above. |
| `slicer '…' is not runnable` | The configured command points at something that is not a command or an executable file. |
| loads then says *empty file* / *loading failed* | The bytes did arrive; the slicer could not read them (a truncated or non-model file). Check the ticket's file. |
| `WARNING: … is group/world-readable` | Only raised while the file still holds a `PRINTQ_TOKEN`. Delete the line, or `chmod 600 ~/.config/printq/slicer.conf`. |

## macOS and Windows

The installer is Linux/XDG only. The helper scripts themselves are portable
(`bash` + `curl`); only the scheme registration differs.

**macOS** — register the schemes with a tiny app wrapper. In *Script Editor*,
save an application that runs:

```applescript
on open location this_URL
  do shell script "/path/to/prusa-open.sh " & quoted form of this_URL
end open location
```

and add `CFBundleURLSchemes` = `printq` (and `printq-anycubic`) to its
`Info.plist`. Set `PRINTQ_SLICER` to
`/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`.

**Windows** — the helpers need a `bash` (Git Bash / WSL). Register the schemes
with a `.reg` file:

```reg
Windows Registry Editor Version 5.00
[HKEY_CLASSES_ROOT\printq]
@="URL:PrintQ - Requests"
"URL Protocol"=""
[HKEY_CLASSES_ROOT\printq\shell\open\command]
@="\"C:\\Program Files\\Git\\bin\\bash.exe\" \"C:/path/to/prusa-open.sh\" \"%1\""
[HKEY_CLASSES_ROOT\printq-anycubic]
@="URL:PrintQ - Requests (Anycubic)"
"URL Protocol"=""
[HKEY_CLASSES_ROOT\printq-anycubic\shell\open\command]
@="\"C:\\Program Files\\Git\\bin\\bash.exe\" \"C:/path/to/anycubic-open.sh\" \"%1\""
```

Both are untested here and offered as starting points — the Linux path is the
supported one, matching the app's own "one printer, one office" shape.

## OrcaSlicer, and other slicers

The Prusa helper opens whatever `PRINTQ_SLICER` points at — it is not tied to
Prusa. OrcaSlicer, for instance, opens `.stl`/`.3mf` from the command line the
same way, so `PRINTQ_SLICER="orca-slicer"` (or the AppImage path) works
unchanged.

OrcaSlicer also has its own `orcaslicer://open?file=` scheme, and unlike
PrusaSlicer it is not obviously locked to an allowlist — if a future version
accepts arbitrary hosts, a direct deep link becomes possible for Orca users and
this helper stays the fallback. Nothing here depends on that.
