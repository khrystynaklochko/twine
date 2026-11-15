# TwinMe Studio — macOS Desktop Companion & Manual Acceptance (QA-002)

## Current Status
`PARTIAL` — Companion bridge implementation and pairing protocol are ready; real-device macOS Accessibility acceptance has not yet been executed on physical Mac hardware inside this cloud Linux sandbox.

## Required macOS Permissions
1. **Accessibility**: System Settings → Privacy & Security → Accessibility → Allow Terminal / TwinMe Companion.
2. **Automation**: Allow controlling allowlisted apps (`Notes`, `TextEdit`, `Finder`) only.

## Local Startup & Pairing
1. Generate a pairing capability token in TwinMe Studio (`/agent` → Desktop Companion Bridge).
2. Run locally on macOS:
   ```bash
   export TWINME_PAIR_TOKEN="<copied-capability-token>"
   python3 twinme_companion.py
   ```
3. Verify `/health` reports `accessibilityEnabled: true`.
4. Test `Revoke` and `Emergency Stop` from TwinMe Studio or `POST http://127.0.0.1:48720/emergency-stop`.

## Known Limits
- Bound strictly to `127.0.0.1`; cloud backend cannot execute actions without an active, unexpired capability token.
- Non-allowlisted apps fail closed with HTTP `403`.
