ORCHESTRATE BACKEND CODEX CONTROL LAYER - README
=================================================

This folder contains the backend-only Codex Control Layer for Orchestrate.

Generated against uploaded backend zip.
Frontend is intentionally excluded because it is not final designed/aligned yet.

Files
-----
- AGENTS.md
  Place this at the root of the backend repository.

- docs/CODEX_SYSTEM_CONSTITUTION.txt
  Defines the authority model and Codex boundaries.

- docs/BACKEND_ACTUAL_MAP.txt
  Real backend map generated from the uploaded zip.

- docs/AI_WIRING_EXECUTION_MAP.txt
  Maps the AI Wiring & Integration plan to actual backend files and services.

- docs/PROTECTED_BOUNDARIES.txt
  Defines high-risk areas and rules Codex must preserve.

- docs/EXECUTION_PROTOCOL.txt
  Defines how Codex should inspect, edit, validate, and report work.

How to install
--------------
1. Copy AGENTS.md into the backend repo root.
2. Copy docs/ into the backend repo root as /docs.
3. Keep the original AI Wiring & Integration Master Record in /docs as well.
4. Ask Codex to read AGENTS.md before making backend changes.

Recommended repo structure after install
----------------------------------------
/AGENTS.md
/docs/CODEX_SYSTEM_CONSTITUTION.txt
/docs/BACKEND_ACTUAL_MAP.txt
/docs/AI_WIRING_EXECUTION_MAP.txt
/docs/PROTECTED_BOUNDARIES.txt
/docs/EXECUTION_PROTOCOL.txt
/docs/ORCHESTRATE_AI_WIRING_AND_INTEGRATION_MASTER_RECORD.txt

Important
---------
This package does not modify backend code. It creates the control layer Codex should obey before touching backend code.
