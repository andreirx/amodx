Check boundary violations and gate status for amodx.

Usage: /verify-requirements

Database: ./amodx.db
Prerequisites: repo must be indexed with declared boundaries.

Steps:
1. Run `rmap violations ./amodx.db amodx` to list all boundary violations
2. Run `rmap gate ./amodx.db amodx` to check CI gate status
3. For each violation, explain what boundary was crossed and why it matters
4. Produce a verification status report: total violations, gate verdict
5. List specific remediation actions for each violation
