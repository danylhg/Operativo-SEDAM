# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SEDAM Móvil — a native Android app (Kotlin + Jetpack Compose) that is the mobile
client for the same real-time tactical tracking system as the sibling repos
`../sedam-web-server` (Node/Socket.IO backend) and `../sedam-web-system` (React
web client). All three speak the same encrypted wire protocol; when changing
message formats or crypto here, check those repos for the counterpart
implementation (`../sedam-web-server/src/crypto.js` for the cipher, and
`../sedam-web-system/src/features/map/milSymbolFactory.js` for SIDC/symbol
conventions).

There is no README and this directory is not a git repository (no `.git` here).

## Build / lint / run

Standard Gradle Android project, single module (`:app`).

```bash
./gradlew assembleDebug          # build debug APK
./gradlew installDebug           # build + install on connected device/emulator
./gradlew lint                   # Android lint
./gradlew clean
```

There are no unit/instrumented test source sets in this project currently — do
not assume a `test`/`androidTest` folder exists before referencing one.

Key toolchain facts (see `gradle/libs.versions.toml`):
- Kotlin 2.0.20, AGP 8.6.1, compileSdk/targetSdk 35, minSdk 26, JVM target 17.
- UI is 100% Jetpack Compose (Material 3) — there are no XML layouts except
  `layout/unit_info_window.xml`, which backs an osmdroid map InfoWindow (Compose
  can't render inside osmdroid's `InfoWindow`, so that one screen is plain
  Android views).

## Architecture

### Connection lifecycle: Login → Handshake → Map

`MainActivity` is the only Activity. It renders `LoginScreen` until
`LoginViewModel.state` becomes `Authenticated`, then swaps to
`AuthenticatedFlow`, which shows `ConnectedScreen` for `CONNECTED_DWELL_MS`
(2.8s) before crossfading into `MapScreen`. The Android back button does not
exit the app — it prompts a logout confirmation that tears down the socket and
returns to `LoginScreen`.

Login (`ui/login/LoginViewModel.kt`) drives a small state machine
(`Idle → Connecting → Handshake → Authenticated | Error`) built on top of
`SocketManager` callbacks (`onPublicKey`, `onReady`, `onError`). Connection
fields (server, port, serial, device_token) are persisted via `SecureStore`
(`EncryptedSharedPreferences`, key material in the Android Keystore) so the
operator doesn't retype them. The backend closes the socket if the crypto
handshake isn't completed within 15s — that timeout is enforced client-side too.

### Wire protocol and crypto (`data/CryptoManager.kt`, `data/SocketManager.kt`)

Handshake sequence, mirrored exactly from the Node backend:
1. Client connects to Socket.IO with `auth = { serial_number, device_token }`.
2. Server emits `crypto:publicKey` (RSA-2048 PEM).
3. Client generates a fresh AES-256 key, wraps it with
   `RSA/OAEP(SHA-256, MGF1=SHA-256)`, sends it back as `crypto:aesKey`.
4. Server emits `crypto:ready` (bool). If `false` or on `connect_error`, the
   login fails and the socket is torn down.

After that, every `data` message is AES-256-GCM (12-byte IV, 16-byte tag),
wire-encoded as `{ iv: hex, data: base64, tag: base64 }`. **Gotcha**: Java's
`"RSA/ECB/OAEPWithSHA-256AndMGF1Padding"` transform defaults MGF1 to SHA-1;
you must pass an explicit `OAEPParameterSpec` with `MGF1ParameterSpec.SHA256`
or the Node side can't unwrap the key. Also note Java's GCM output is
`ciphertext||tag` concatenated, so it must be split before putting `tag` on
the wire (the backend expects them separate).

`network_security_config.xml` pins the server's mkcert-issued local CA
(`res/raw/sedam_ca.pem`) for the hardcoded LAN IP domain — that config block
needs to be updated/removed if the server moves to a public CA.

### Session state (`data/SessionRepository.kt`)

A singleton (not a DI-provided instance) shared between the login and map
screens; owns the one `SocketManager`/`CryptoManager` pair for the process.
Exposes `StateFlow`s for: own id (`myId`, learned from the first `data`
payload after login), other units' positions (`units`), display-name aliases
(`aliases`), panicking unit ids (`panics`), waypoints, and target tracks.

All inbound app messages are comma-separated strings (not JSON) of the form
`TYPE,field1,field2,...`, optionally prefixed with `sessionId[:]`. Parsing is
by `substringBefore(",")` dispatch in `handleData()` — see that function for
the full message catalog (`OWNPOS`, `ID_ALIAS`, `MSGPANIC`, `WAYPOINTPOS`,
`TRACKPOS`, `SESSION_OUT`). The server excludes the sending socket from
broadcasts, so a client never receives echoes of its own emissions — own
waypoints/targets/aliases are reflected into local state immediately by the
sender rather than waiting for a round trip.

Waypoints and targets are **private by default** on creation; sharing/
transmitting is an explicit opt-in per object (`shareWaypoint` /
`startTransmitTarget`), and removal always emits a remove signal regardless of
current sharing state, to avoid leaving "ghost" objects on other clients.
`tickTargets()` implements client-side dead reckoning for one's own
transmitting targets (Haversine `movePoint`, re-emits every ~2s) — this must
match the same formula used server/web-side.

### Map rendering (`ui/map/MapScreen.kt`)

Uses **osmdroid** (not Google Maps) for fully offline-capable tile rendering
with a SQLite tile cache — this is a deliberate choice for field/offline use,
not a placeholder. `MapScreen` is a single large composable file; the pattern
is one file per screen with private composables for its sub-parts (top bar,
drawer, dialogs, buttons) rather than separate files per component — follow
that convention when extending it rather than introducing a new
one-composable-per-file structure.

Military symbology uses MIL-STD-2525C SIDCs rendered by the official armyc2
renderer (`mil-sym-android-renderer`, package `armyc2.c2sd`), wrapped in
`data/MilSymbolRenderer.kt`. Two render paths: `bitmapFor()` (static, for list/
drawer icons) and `iconFor()` (with heading via the native "direction of
movement" modifier `Q`, cached per SIDC + heading bucketed to 5°, with an
optional red panic halo). `SidcCatalog.kt` builds/parses the 15-char SIDC
strings for targets and waypoints; `data/SedamUnits.kt` is a large static
lookup table (`station_id -> UnitDef`) of ~600 known fleet units ported from
the web system's unit catalog — treat it as generated reference data, not
something to hand-edit piecemeal.

### Everything is in Spanish

All in-code comments, UI strings, commit-worthy identifiers in domain models,
and dialog copy are in Spanish (Mexican military/naval terminology — SIDC,
OWNPOS, MSGPANIC, etc. mirror the backend's own protocol vocabulary). Keep new
comments and user-facing strings in Spanish to stay consistent with the rest
of the codebase.
