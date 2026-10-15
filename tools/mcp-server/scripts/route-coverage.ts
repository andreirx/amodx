/**
 * Route-coverage drift oracle for the MCP server (slice mcp-sync-1).
 *
 * Reads src/index.ts as TEXT (no import, so no .env, no network) and checks it against
 * routes.json, the live API Gateway route table that the operator refreshes.
 *
 * FAILS (exit 1) when:
 *   1. a call targets a method+path that is not in routes.json and not in `knownBroken`;
 *   2. a `knownBroken` entry is no longer called (stale entries would hide a regression);
 *   3. a `${API_URL}` use cannot be attributed to an axios call (the oracle would be blind to it);
 *   4. ARCHITECTURE.md's "## Tools (N total)" differs from the count of `server.tool(` calls.
 * PRINTS, never fails on: admin routes that no tool calls (coverage is a product choice).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "src/index.ts"), "utf8");
const routeTable: { generatedAt: string; stage: string; routes: string[] } =
    JSON.parse(readFileSync(join(ROOT, "routes.json"), "utf8"));
const architecture = readFileSync(join(ROOT, "ARCHITECTURE.md"), "utf8");

// Calls known to target a path that does not exist. Commerce track: the commerce slice
// fixes the two tools and deletes these entries (check 2 then forces the deletion).
const knownBroken = new Map<string, string>([
    ["GET /delivery", "commerce track — live route is GET /delivery/config"],
    ["PUT /delivery", "commerce track — live route is PUT /delivery/config"],
]);

const API_MARK = "${API_URL}";
const HOLE = "\u0000"; // stands for one `${...}` interpolation inside a URL

const lineOf = (pos: number) => source.slice(0, pos).split("\n").length;

/** Body of the template literal whose opening backtick is at `start`; `${...}` → HOLE. */
function readTemplate(start: number): { text: string; end: number } {
    let text = "";
    let i = start + 1;
    while (source[i] !== "`") {
        if (source[i] === "$" && source[i + 1] === "{") {
            let depth = 1;
            i += 2;
            while (depth > 0) {
                if (source[i] === "{") depth++;
                else if (source[i] === "}") depth--;
                i++;
            }
            text += HOLE;
        } else {
            text += source[i++];
        }
        if (i >= source.length) throw new Error(`unterminated template literal at line ${lineOf(start)}`);
    }
    return { text, end: i + 1 };
}

/** Every template literal starting at `${API_URL}` inside [from, to), with its position. */
function apiTemplatesIn(from: number, to: number): { text: string; pos: number }[] {
    const found: { text: string; pos: number }[] = [];
    for (let i = from; i < to; i++) {
        if (source[i] === "`" && source.startsWith(API_MARK, i + 1)) {
            const { text, end } = readTemplate(i);
            found.push({ text, pos: i + 1 });
            i = end - 1;
        }
    }
    return found;
}

interface Call { method: string; segments: string[]; line: number }

// --- Extract calls -----------------------------------------------------------------------
// An axios call's first argument is either the template literal itself, or an identifier
// bound by a `const <id> = ...;` above it (the `const url = cond ? `a` : `b`` pattern).
const calls: Call[] = [];
const attributed = new Set<number>();
const callRe = /axios\.(get|post|put|delete|patch)\(\s*([`A-Za-z_])/g;
for (const m of source.matchAll(callRe)) {
    const method = m[1].toUpperCase();
    const argStart = m.index! + m[0].length - 1;
    let templates: { text: string; pos: number }[];
    if (source[argStart] === "`") {
        templates = source.startsWith(API_MARK, argStart + 1) ? [{ ...readTemplate(argStart), pos: argStart + 1 }] : [];
    } else {
        const ident = /^[A-Za-z_]\w*/.exec(source.slice(argStart))![0];
        const declAt = source.lastIndexOf(`const ${ident} =`, argStart);
        templates = declAt < 0 ? [] : apiTemplatesIn(declAt, source.indexOf(";", declAt));
    }
    for (const t of templates) {
        attributed.add(t.pos);
        const pathPart = t.text.slice(1); // readTemplate turned the leading ${API_URL} into one HOLE
        const noQuery = pathPart.split("?")[0];
        calls.push({ method, segments: noQuery.split("/").filter(Boolean), line: lineOf(t.pos) });
    }
}

// --- Match against the route table --------------------------------------------------------
const routes = routeTable.routes.map((key) => {
    const [method, path] = key.split(" ");
    return { key, method, path, segments: path.split("/").filter(Boolean) };
});
const isParam = (seg: string) => seg.startsWith("{") && seg.endsWith("}");

function matchRoute(call: Call) {
    return routes.find((r) =>
        r.method === call.method &&
        r.segments.length === call.segments.length &&
        r.segments.every((seg, i) => (isParam(seg) ? call.segments[i] === HOLE : seg === call.segments[i])),
    );
}
const render = (c: Call) => `${c.method} /${c.segments.map((s) => (s === HOLE ? "{x}" : s)).join("/")}`;

const failures: string[] = [];
const covered = new Set<string>();
const brokenSeen = new Set<string>();
for (const call of calls) {
    const route = matchRoute(call);
    if (route) { covered.add(route.key); continue; }
    const key = render(call);
    if (knownBroken.has(key)) { brokenSeen.add(key); continue; }
    failures.push(`line ${call.line}: ${key} is not in routes.json`);
}
for (const [key, note] of knownBroken) {
    if (!brokenSeen.has(key)) failures.push(`knownBroken entry "${key}" (${note}) is no longer called — delete it`);
}

// Every `${API_URL}` use must belong to a call the oracle parsed.
for (let i = source.indexOf(API_MARK); i >= 0; i = source.indexOf(API_MARK, i + 1)) {
    if (!attributed.has(i)) failures.push(`line ${lineOf(i)}: \${API_URL} use not attributable to an axios call`);
}

// --- ARCHITECTURE.md tool count ------------------------------------------------------------
const toolCount = source.split("server.tool(").length - 1;
const documented = /^## Tools \((\d+) total\)/m.exec(architecture);
if (!documented) failures.push(`ARCHITECTURE.md has no "## Tools (N total)" heading`);
else if (Number(documented[1]) !== toolCount) {
    failures.push(`ARCHITECTURE.md says ${documented[1]} tools; src/index.ts registers ${toolCount}`);
}

// --- Report ---------------------------------------------------------------------------------
const admin = routes.filter((r) => !r.path.startsWith("/public/") && !r.path.startsWith("/webhooks/"));
const uncovered = admin.filter((r) => !covered.has(r.key));
const byArea = new Map<string, string[]>();
for (const r of uncovered) {
    const area = r.segments[0];
    byArea.set(area, [...(byArea.get(area) ?? []), r.key]);
}

console.log(`routes.json: ${routes.length} routes (stage ${routeTable.stage}, generated ${routeTable.generatedAt}); admin routes: ${admin.length}`);
console.log(`server.tool registrations: ${toolCount}; API calls parsed: ${calls.length}; distinct routes called: ${covered.size}; knownBroken calls: ${brokenSeen.size}`);
console.log(`\nCoverage report — admin routes with no tool: ${uncovered.length}`);
for (const [area, keys] of [...byArea].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${area}: ${keys.join(", ")}`);
}
if (failures.length > 0) {
    console.error(`\nFAIL (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log("\nPASS: every call targets a live route; ARCHITECTURE.md tool count matches.");
