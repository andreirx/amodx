Investigate a symbol in the amodx codebase - find callers, callees, and trust context using rmap.

Usage: /investigate-symbol <SymbolName>

Database: ./amodx.db

Steps:
1. Run `rmap callers ./amodx.db amodx $ARGUMENTS` to find who references this symbol
2. Run `rmap callees ./amodx.db amodx $ARGUMENTS` to find what this symbol depends on
3. Run `rmap trust ./amodx.db amodx` to check extraction reliability
4. Summarize: what the symbol is, who depends on it, what it depends on, trust caveats if any
