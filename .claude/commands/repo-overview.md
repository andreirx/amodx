Index the amodx codebase with rmap and produce a structural overview.

Usage: /repo-overview

Database: ./amodx.db

Steps:
1. Run `rmap index . ./amodx.db` to index (or re-index) the codebase
2. Run `rmap trust ./amodx.db amodx` for extraction reliability report
3. Run `rmap check ./amodx.db amodx` for structural health check
4. Run `rmap modules list ./amodx.db amodx` for module inventory
5. Run `rmap boundaries summary ./amodx.db amodx` for HTTP/CLI surface summary
6. Run `rmap violations ./amodx.db amodx` for boundary violations
7. Produce a summary: module count, boundary surfaces, violations, trust level, key concerns
