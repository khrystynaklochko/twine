# TwinMe Studio — 60-Second Honest Demo Runbook (`REL-003`)

Every action below executes against real local state, Gemini 4 Hydrogen, and Playwright Chromium:

1. **0:00–0:10 — Establish Individual Twin (`/onboarding`)**:
   - Open `/` showing honest empty state (`0 memories, 0 skills, 0 runs`).
   - Go to `/onboarding`, enter individual name & goal, confirm explicit consent toggles, click **Create My Personal Twin**.
2. **0:10–0:25 — Teach by Demonstration (`/teach`)**:
   - Click **Start Teach Recording** on `/fixture/research`.
   - Type `capability` in the search box and click **Search Papers** inside the live frame.
   - Click **Finish & Review**, inspect the chronological trace, click **Extract Parameterized Skill** (Gemini 4 Hydrogen), and click **Approve & Save to Skill Library**.
3. **0:25–0:45 — Supervised Execution on Changed Input (`/skills` → `/agent`)**:
   - On `/skills`, change the `query` parameter to `selector` and click **Run in Agent Cockpit**.
   - Click **Execute Live Playwright Run** to watch real Playwright steps, live screenshots, and extracted comparison rows stream over SSE.
4. **0:45–0:55 — Human Intervention & Correction (`/agent` → `/skills`)**:
   - Click **Run With High-Impact Save Gate** to demonstrate fresh single-use approval pause (`awaiting_approval`), then approve & verify.
   - Or click **Pause / Emergency Stop** mid-run, or propose a step correction (`v1 → v2`) and accept the diff on `/skills`.
5. **0:55–1:00 — Privacy & Ownership (`/settings/privacy`)**:
   - Click **Export Complete Twin Archive (JSON)** and show selective delete / wipe controls.
