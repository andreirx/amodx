import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";

/**
 * CMRC-1A, test T3 — the backend part of requirement C1 (docs/slices/cmrc-1a.md § Proofs; docs/slices/cmrc-1.md
 * § 5.2, § 5.9): within `backend/src`, `lib/commerce-db.ts` is the only code that writes a commerce-private key
 * prefix. What the test proves in full: in the scanned directories, the prefixes are written in that file and in
 * exactly three named reads of the public renderer (`RENDERER_READS`, sites S16-S18), and nowhere else. It does NOT
 * prove that the renderer is free of these keys: the three reads are still there, and C1 is complete only when
 * `cmrc-1b` (S17, S18) and part L of `cmrc-1` (S16) have removed them and this list is empty.
 *
 * How: every source file of the two runtimes that can reach DynamoDB (`backend/src`, `renderer/src`) and of the
 * workspace packages they bundle (`packages/<name>/src`) is parsed with the TypeScript compiler API. The walk looks at
 * string literals and at the text parts of template literals — by syntax tree, so a prefix in a comment is not a hit.
 * A hit outside `commerce-db.ts` fails the test, except the named, counted entries of `RENDERER_READS` (the three
 * renderer reads that CMRC-1A does not touch; `cmrc-1b` and part L delete them, and this list with them).
 *
 * The prefixes come from `COMMERCE_PRIVATE_PREFIXES` of the module: one list. A kind added there is guarded here with
 * no edit. `cmrc-1-commerce-db.test.ts` pins that list to its literal values.
 *
 * The files are read from the working tree (not from `git ls-files`), so a new file is checked before it is added.
 *
 * What this test CANNOT see (docs/slices/cmrc-1a.md § Proofs states how each gap is covered):
 *  - a prefix that exists only at run time: joined from parts (`"ORD" + "ER#"`), or received in a request;
 *  - a prefix in a regular-expression literal (it can match a key; it cannot build one);
 *  - a file outside the scanned directories: `scripts/migrate-commerce-private-table.ts` (the operational copy tool,
 *    changed by `cmrc-2`), tests, `admin/`, `tools/`, `infra/`.
 */

vi.mock("../../src/lib/db.js", () => ({ db: {}, TABLE_NAME: "test-table" }));

import { COMMERCE_PRIVATE_PREFIXES } from "../../src/lib/commerce-db.js";

const ROOT = path.resolve(__dirname, "../../..");
const OWNER = "backend/src/lib/commerce-db.ts";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The reads of the public renderer that still name a commerce-private key: file, enclosing function, prefix. */
const RENDERER_READS = [
    ["renderer/src/lib/dynamo-customer-reads.ts", "getCustomerOrders", "CUSTORDER#"],   // S17 — cmrc-1b deletes it
    ["renderer/src/lib/dynamo-customer-reads.ts", "getCustomerProfile", "CUSTOMER#"],   // S18 — cmrc-1b deletes it
    ["renderer/src/lib/dynamo-customer-reads.ts", "getOrderForCustomer", "ORDER#"],     // S16 — part L deletes it
] as const;

type Hit = { prefix: string; functionName: string; line: number };

/**
 * The prefixes of `prefixes` that `text` contains. An occurrence that follows a capital letter belongs to a longer
 * name and is not counted for the shorter one: `CUSTORDER#` is a hit for `CUSTORDER#`, not for `ORDER#`.
 */
function prefixesIn(text: string, prefixes: readonly string[]): string[] {
    return prefixes.filter((prefix) => {
        for (let at = text.indexOf(prefix); at !== -1; at = text.indexOf(prefix, at + 1)) {
            if (at === 0 || !/[A-Z]/.test(text[at - 1])) return true;
        }
        return false;
    });
}

function enclosingFunctionName(node: ts.Node): string {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
        if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.getText();
    }
    return "(top level)";
}

/** Every string literal and template text part of one source text that contains a prefix. */
function scan(fileName: string, sourceText: string, prefixes: readonly string[]): Hit[] {
    const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
    const hits: Hit[] = [];
    const visit = (node: ts.Node): void => {
        // StringLiteral, NoSubstitutionTemplateLiteral, and the head / middle / tail text of a template with `${…}`.
        if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddleOrTemplateTail(node)) {
            for (const prefix of prefixesIn(node.text, prefixes)) {
                hits.push({ prefix, functionName: enclosingFunctionName(node), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return hits;
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        if (entry === "node_modules") return [];
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return SOURCE_EXTENSIONS.includes(path.extname(entry)) ? [full] : [];
    });
}

const SCANNED_DIRECTORIES = [
    "backend/src",
    "renderer/src",
    ...readdirSync(path.join(ROOT, "packages"))
        .map((name) => `packages/${name}/src`)
        .filter((dir) => { try { return statSync(path.join(ROOT, dir)).isDirectory(); } catch { return false; } }),
];
const FILES = SCANNED_DIRECTORIES.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).map((full) => path.relative(ROOT, full).split(path.sep).join("/"));
const hitsOf = (file: string) => scan(file, readFileSync(path.join(ROOT, file), "utf8"), COMMERCE_PRIVATE_PREFIXES);

describe("CMRC-1A T3 — the scanner (self-test)", () => {
    const P = COMMERCE_PRIVATE_PREFIXES;
    const found = (text: string) => scan("fixture.ts", text, P).map((h) => h.prefix);

    it("finds a prefix in a string literal, in a template without holes and in each text part of a template", () => {
        expect(found(`const a = "ORDER#";`)).toEqual(["ORDER#"]);
        expect(found("const a = `CUSTOMER#`;")).toEqual(["CUSTOMER#"]);
        expect(found("const a = `ORDER#${id}`;")).toEqual(["ORDER#"]);
        expect(found("const a = `${pk}|CUSTOMER#${email}`;")).toEqual(["CUSTOMER#"]);
        expect(found("const a = `${pk}|${x}COUNTER#ORDER`;")).toEqual(["COUNTER#ORDER"]);
        expect(found(`const a = { ":sk": 'CUSTORDER#' };`)).toEqual(["CUSTORDER#"]);
    });

    it("does not find a prefix in a comment", () => {
        expect(found(`// every CUSTOMER# / CUSTORDER# key\n/* ORDER# and COUNTER#ORDER */\nconst a = "x";`)).toEqual([]);
    });

    it("counts CUSTORDER# as itself, not as ORDER#; a longer capital name is another family", () => {
        expect(found("const a = `CUSTORDER#${email}#`;")).toEqual(["CUSTORDER#"]);
        expect(found(`const a = "PREORDER#"; const b = "SUBCUSTOMER#";`)).toEqual([]);
        expect(found(`const a = "x ORDER#"; const b = "sk=CUSTOMER#";`)).toEqual(["ORDER#", "CUSTOMER#"]);
    });

    it("names the enclosing function and the line", () => {
        expect(scan("fixture.ts", "export async function readOne() {\n  return `ORDER#${1}`;\n}\nconst other = () => 'CUSTOMER#';", P)).toEqual([
            { prefix: "ORDER#", functionName: "readOne", line: 2 },
            { prefix: "CUSTOMER#", functionName: "other", line: 4 },
        ]);
    });

    it("the limit it has: a prefix joined from parts is not found", () => {
        expect(found(`const a = "ORD" + "ER#";`)).toEqual([]);
    });
});

describe("CMRC-1A T3 — in backend/src, renderer/src and packages/*/src the commerce-private key prefixes are written in lib/commerce-db.ts and in three named renderer reads (C1, backend part)", () => {
    it("the walk reads the runtime sources (it cannot pass on an empty file list)", () => {
        expect(SCANNED_DIRECTORIES).toEqual(expect.arrayContaining(["backend/src", "renderer/src", "packages/shared/src"]));
        expect(FILES.length).toBeGreaterThan(300);
        for (const known of [OWNER, "backend/src/orders/create.ts", "backend/src/resources/presign.ts", "renderer/src/lib/dynamo-customer-reads.ts", "packages/shared/src/normalizeEmail.ts"]) {
            expect(FILES).toContain(known);
        }
    });

    it("commerce-db.ts holds each of the prefixes (the scanner sees the owner file)", () => {
        expect([...new Set(hitsOf(OWNER).map((h) => h.prefix))].sort()).toEqual([...COMMERCE_PRIVATE_PREFIXES].sort());
    });

    it("no other scanned file holds one: backend/src and packages/*/src hold none; renderer/src holds exactly the three named reads (S16-S18)", () => {
        const outside = FILES.filter((file) => file !== OWNER)
            .flatMap((file) => hitsOf(file).map((h) => [file, h.functionName, h.prefix, h.line] as const));
        // The message of a failure lists file, function, prefix and line of every hit.
        expect(outside.map(([file, functionName, prefix]) => [file, functionName, prefix]).sort(), JSON.stringify(outside, null, 2))
            .toEqual(RENDERER_READS.map((entry) => [...entry]).sort());
    });
});
