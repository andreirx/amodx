Produce a structural health report for the amodx codebase.

Usage: /assess-health

Database: ./amodx.db
Prerequisites: repo must be indexed. Run `/repo-overview` first if needed.

Steps:
1. Run `rmap trust ./amodx.db amodx` for extraction reliability
2. Run `rmap check ./amodx.db amodx` for structural and quality signals
3. Run `rmap modules list ./amodx.db amodx` for module inventory
4. Run `rmap violations ./amodx.db amodx` for boundary compliance
5. Run `rmap boundaries summary ./amodx.db amodx` for API surface coverage
6. Run `rmap gate ./amodx.db amodx` for CI gate status
7. Produce a health report with sections: Trust, Structure, Modules, Boundaries, Violations, Gate
8. Flag specific concerns: low trust areas, boundary violations, unlinked surfaces
