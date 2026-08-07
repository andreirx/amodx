# FND-2: Migrate inline email normalization to normalizeEmail()

- **Status:** PLANNED
- **Track:** Foundation (implementation wave slice 1, human-ordered 2026-08-07)
- **Depends:** fnd-1 (SHIPPED)
- **Source:** fnd-1 build report §call-site inventory; PD-001 as amended

## Scope

Replace every inline email `.toLowerCase()`/trim at the call sites inventoried in the
fnd-1 build report (~7, backend + renderer) with `normalizeEmail()` from
`@amodx/shared`. RE-VERIFY the inventory first (grep; treat the report as a subset).
Behavior note per site: for sites where the stored/compared value could differ under
NFKC (non-ASCII), record the delta; existing PERSISTED values are NOT migrated (no
data change — record any implication for lookups as findings).

## Non-scope

No schema changes; no persisted-data migration; no new validation.

## DoD / evidence

Each call site diffed + unit-covered where a pure seam exists; root build + typecheck
+ unit suites green; serving-contract suite green if any renderer site is touched.
