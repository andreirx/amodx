import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { DYNAMO_RESERVED_WORDS } from "../../src/lib/dynamo-reserved-words.js";

/**
 * PROJECTION-RESERVED-1 — the guard against a bare DynamoDB reserved word in an expression.
 *
 * DynamoDB refuses a request whose ProjectionExpression, FilterExpression, KeyConditionExpression,
 * ConditionExpression or UpdateExpression names an attribute that is a reserved word without an
 * ExpressionAttributeNames alias (`total` must be written `#total`). The handler tests run against test doubles that
 * do not parse expressions, so the refusal was invisible until staging. This module gives the tests DynamoDB's rule:
 *
 *  - `bareReservedWords(expression, kind)` — the tokenizer: every bare attribute name in the expression that is a
 *    reserved word (case-insensitive, as DynamoDB compares).
 *  - `assertNoBareReservedWord(input)` — throws DynamoDB's ValidationException text for the first bare reserved word in
 *    any expression of one command input.
 *  - `guardCommandClasses(module)` — the module with each expression-carrying command class replaced by a subclass
 *    whose constructor calls `assertNoBareReservedWord`. `dynamo-reserved-setup.ts` (a `setupFiles` entry) applies it
 *    to the real `@aws-sdk/lib-dynamodb`, and every test file that replaces that module applies it to its own factory
 *    (a rule enforced by `projection-reserved-1.test.ts`), so the doubles — MemoryTable, LangTable, ad-hoc `vi.fn`
 *    mocks, aws-sdk-client-mock and the replacing factories — all see the refusal.
 *  - `scanExpressionSites(file)` — the static scan: a LINT for the construction forms the repository uses today, NOT a
 *    proof (operator ruling PR1-STATIC-SCOPE, docs/slices/projection-reserved-1.md). It lists the expression sites
 *    written in the forms it recognizes and resolves each to the texts it can derive from the forms it models:
 *    literals, templates, `+`, `?:`, `const`/`let` values, imported `const`s, `[…].join()` with the file's
 *    `.push()` / `.unshift()`, `.map(arrow)`, object-literal properties, same-file function returns and the same-file
 *    call arguments of a parameter. A change it recognizes as unmodelled (see `slotTexts` and the allow-list
 *    `hasUnmodelledUse`) becomes a hole where it can tell. Code that changes a value through a form it does not model
 *    CAN be reported clean: known forms in docs/TECH-DEBT.md § F-RESERVED-SCAN-LIMITS. A hole is `nonNameHoles` when
 *    it only stands inside a `#alias`, a `:value` or a `[index]`, `unresolved` otherwise.
 */

export type ExpressionKind =
    | "ProjectionExpression"
    | "FilterExpression"
    | "KeyConditionExpression"
    | "ConditionExpression"
    | "UpdateExpression";

export const EXPRESSION_KINDS: ReadonlySet<string> = new Set<ExpressionKind>([
    "ProjectionExpression", "FilterExpression", "KeyConditionExpression", "ConditionExpression", "UpdateExpression",
]);

/** DynamoDB's expression functions (case-sensitive); a name followed by `(` is a call, not an attribute. */
const FUNCTIONS = new Set([
    "attribute_exists", "attribute_not_exists", "attribute_type", "begins_with", "contains", "size", "if_not_exists", "list_append",
]);
/** Operators of condition-shaped expressions (case-insensitive). */
const CONDITION_KEYWORDS = new Set(["AND", "OR", "NOT", "BETWEEN", "IN"]);
/** Clause keywords of an UpdateExpression (case-insensitive). */
const UPDATE_KEYWORDS = new Set(["SET", "REMOVE", "ADD", "DELETE"]);

function keywordsOf(kind: ExpressionKind): ReadonlySet<string> {
    switch (kind) {
        case "ProjectionExpression": return new Set();
        case "UpdateExpression": return UPDATE_KEYWORDS;
        case "FilterExpression":
        case "KeyConditionExpression":
        case "ConditionExpression": return CONDITION_KEYWORDS;
    }
}

/** Every bare attribute name (not `#alias`, not `:value`, not a function, not a keyword of `kind`), in order. */
export function bareNames(expression: string, kind: ExpressionKind): string[] {
    const keywords = keywordsOf(kind);
    const out: string[] = [];
    for (const m of expression.matchAll(/[#:]?[A-Za-z_][A-Za-z0-9_]*/g)) {
        const token = m[0];
        if (token.startsWith("#") || token.startsWith(":")) continue;
        if (FUNCTIONS.has(token) && /^\s*\(/.test(expression.slice(m.index! + token.length))) continue;
        if (keywords.has(token.toUpperCase())) continue;
        out.push(token);
    }
    return out;
}

/** The bare attribute names of `expression` that DynamoDB reserves, as written. */
export function bareReservedWords(expression: string, kind: ExpressionKind): string[] {
    return bareNames(expression, kind).filter((name) => DYNAMO_RESERVED_WORDS.has(name.toUpperCase()));
}

/** Keys whose values are item data, never expressions — the walk does not descend into them. */
const DATA_KEYS = new Set(["Item", "Key", "Keys", "ExpressionAttributeValues", "ExclusiveStartKey"]);

/**
 * Throws, as DynamoDB does, when any expression in one command input (top level, `RequestItems[table]` of a BatchGet,
 * `TransactItems[i].Put/Update/Delete/ConditionCheck/Get`) holds a bare reserved word. Error name and message are
 * DynamoDB's: `ValidationException`, `Invalid <Kind>: Attribute name is a reserved keyword; reserved keyword: <name>`.
 */
export function assertNoBareReservedWord(input: unknown): void {
    if (input === null || typeof input !== "object") return;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (DATA_KEYS.has(key)) continue;
        if (EXPRESSION_KINDS.has(key) && typeof value === "string") {
            const [word] = bareReservedWords(value, key as ExpressionKind);
            if (word !== undefined) {
                const error = new Error(`Invalid ${key}: Attribute name is a reserved keyword; reserved keyword: ${word}`);
                error.name = "ValidationException";
                throw error;
            }
        } else if (typeof value === "object") {
            assertNoBareReservedWord(value);
        }
    }
}

/** The `@aws-sdk/lib-dynamodb` command classes whose input can carry an expression. */
const GUARDED_COMMANDS = [
    "GetCommand", "PutCommand", "UpdateCommand", "DeleteCommand", "QueryCommand", "ScanCommand",
    "BatchGetCommand", "TransactGetCommand", "TransactWriteCommand",
] as const;

/**
 * `mod` with each command class of GUARDED_COMMANDS that it exports replaced by a same-named subclass whose
 * constructor first calls `assertNoBareReservedWord(input)`. The ONE way a unit test may supply
 * `@aws-sdk/lib-dynamodb`: `dynamo-reserved-setup.ts` wraps the real module with it, and every test file that replaces
 * the module with its own `vi.mock` factory must return the factory's module through it (the rule is enforced by
 * `projection-reserved-1.test.ts`). Works on the real classes and on a test's fake classes alike; the subclass keeps
 * the class name and `instanceof`.
 */
export function guardCommandClasses<M extends object>(mod: M): M {
    const out: Record<string, unknown> = { ...(mod as Record<string, unknown>) };
    for (const name of GUARDED_COMMANDS) {
        const Original = (mod as Record<string, unknown>)[name];
        if (typeof Original !== "function") continue;
        const Base = Original as new (...args: any[]) => object;
        out[name] = { [name]: class extends Base { constructor(...args: any[]) { assertNoBareReservedWord(args[0]); super(...args); } } }[name];
    }
    return out as M;
}

// ─── Static scan ────────────────────────────────────────────────────────────────────────────────────────────────

export type ExpressionSite = {
    file: string;
    line: number;
    kind: ExpressionKind;
    /** The texts the scan derived for the expression from the forms it models — not necessarily every text it can take
     *  at run time. A run-time part the scan recognized is a hole `\u0000<n>\u0001` (no name characters). */
    texts: string[];
    /** Source text of each recognized run-time part that stands where a BARE attribute name can stand. Empty means no
     *  unresolved part was reported; this is not proof of cleanliness (operator ruling PR1-STATIC-SCOPE). */
    unresolved: string[];
    /** Source text of each recognized run-time part that, in the derived texts, only stands inside a `#alias`, a
     *  `:value` or a `[index]` (for example `#${field} = :${field}`, `#images[${i}]`). The scan treats it as part of
     *  that token and reports no bare name for it; that holds only if the run-time value holds no separator (`, `, a
     *  space), which the scan does not check. */
    nonNameHoles: string[];
};

const MAX_TEXTS = 256;
const MAX_DEPTH = 24;

/** Per site: the source file in view, the holes found, the recursion depth, and (shared by the whole site) the texts of
 *  each node already evaluated plus the nodes being evaluated — a node met again while in progress is a cycle
 *  (`x = x + …`) and becomes a hole. */
type Ctx = { sf: ts.SourceFile; holes: string[]; depth: number; memo: Map<ts.Node, string[]>; active: Set<ts.Node> };

const parsed = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
    let sf = parsed.get(file);
    if (!sf) {
        const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        sf = ts.createSourceFile(file, readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true, kind);
        parsed.set(file, sf);
    }
    return sf;
}

function hole(node: ts.Node, ctx: Ctx): string[] {
    const index = ctx.holes.push(node.getText(ctx.sf).replace(/\s+/g, " ")) - 1;
    return [`\u0000${index}\u0001`];
}

function product(a: string[], b: string[], node: ts.Node, ctx: Ctx): string[] {
    if (a.length * b.length > MAX_TEXTS) return hole(node, ctx);
    return a.flatMap((x) => b.map((y) => x + y));
}

function descendants(root: ts.Node, pick: (n: ts.Node) => boolean): ts.Node[] {
    const out: ts.Node[] = [];
    const walk = (n: ts.Node) => { if (pick(n)) out.push(n); ts.forEachChild(n, walk); };
    walk(root);
    return out;
}

const unwrap = (n: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)
        ? unwrap(n.expression) : n;

/** The member name of `x.name` or `x["name"]` (a literal key); `undefined` for any other node. */
function memberName(n: ts.Node): string | undefined {
    if (ts.isPropertyAccessExpression(n)) return n.name.text;
    if (ts.isElementAccessExpression(n) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression))) {
        return n.argumentExpression.text;
    }
    return undefined;
}

/** The identifier an access chain starts from (`a` of `a.b["c"].d`); `undefined` when it starts from a call etc. */
function rootIdentifier(n: ts.Expression): ts.Identifier | undefined {
    n = unwrap(n);
    while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = unwrap(n.expression);
    return ts.isIdentifier(n) ? n : undefined;
}

const isAssignment = (n: ts.Node): n is ts.BinaryExpression =>
    ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment;

/**
 * The assignments in `sf` that the scan recognizes as writes to the binding `name`: an assignment of any operator
 * whose target is `name`, a member chain rooted at `name`, or a destructuring pattern that names it. A write made
 * through another name (an alias, `this`, a callback parameter) is not among them. Same-named bindings of other scopes
 * are included (a write there makes the scan report more, not less).
 */
function writesTo(sf: ts.SourceFile, name: string): ts.BinaryExpression[] {
    return descendants(sf, (n) => isAssignment(n) && (
        ts.isObjectLiteralExpression(n.left) || ts.isArrayLiteralExpression(n.left)
            ? descendants(n.left, (x) => ts.isIdentifier(x) && x.text === name).length > 0
            : rootIdentifier(n.left)?.text === name)) as ts.BinaryExpression[];
}

/**
 * The method names `hasUnmodelledUse` accepts in a dot call on an array binding: `push` / `unshift` (`arrayElements`
 * collects their arguments) and names of array methods that only read. A call the classifier recognizes with any
 * other name, or through a bracket (`p["push"](…)`), is reported unmodelled. The classifier reads the syntax right
 * around the use: a parenthesised or cast-wrapped call (`(p.push)(…)`) is read as a member read, and a method name
 * does not prove that the receiver is a native array (F-RESERVED-SCAN-LIMITS).
 */
const MODELLED_METHODS = new Set(["push", "unshift", "join", "map", "filter", "flatMap", "some", "every", "find", "findIndex", "forEach", "includes", "indexOf", "slice"]);
/** Of MODELLED_METHODS, those that take a callback. */
const CALLBACK_METHODS = new Set(["map", "filter", "flatMap", "some", "every", "find", "findIndex", "forEach"]);

/**
 * A callback the scan accepts: an arrow with at most two declared parameters. This rejects a named third `array`
 * parameter; it does not reject a rest parameter (`(...a) =>`), which still receives the array (F-RESERVED-SCAN-LIMITS).
 */
const isModelledCallback = (a: ts.Expression | undefined) => {
    const f = a && unwrap(a);
    return f !== undefined && ts.isArrowFunction(f) && f.parameters.length <= 2;
};

/**
 * True when the scan recognizes a use of the binding `name` in `sf` outside its allow-list (for example an alias
 * `const q = p`, `return p`, `f(p)`, `{ p }`, `export { p }`, `p.change()`, `p["push"](…)`, a callback with a named
 * `array` parameter). False does not prove that the binding is unchanged: the classifier reads the syntax right around
 * each use, so some unmodelled forms read as allowed (F-RESERVED-SCAN-LIMITS). The allow-list:
 *  - a member read that is not called, as the classifier sees it (`p.x`, `p["x"]`, `p[i]`; a write through it is
 *    `writesTo`'s business);
 *  - a dot call with a MODELLED_METHODS name; a callback argument must pass `isModelledCallback`;
 *  - the target of a write (`writesTo`), a spread, a template span, the declaration itself, an import;
 *  - the input of `new <Name>Command(…)` (assumed: an SDK command keeps its input as given).
 */
function hasUnmodelledUse(sf: ts.SourceFile, name: string): boolean {
    return descendants(sf, (n) => {
        if (!ts.isIdentifier(n) || n.text !== name) return false;
        const parent = n.parent;
        if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === n) {
            const call = parent.parent;
            if (!(ts.isCallExpression(call) && call.expression === parent)) return false; // a member read
            if (!ts.isPropertyAccessExpression(parent) || !MODELLED_METHODS.has(parent.name.text)) return true;
            return CALLBACK_METHODS.has(parent.name.text) && !isModelledCallback(call.arguments[0]);
        }
        if (ts.isPropertyAccessExpression(parent) && parent.name === n) return false; // `x.name`: a property name, not the binding
        if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)) && parent.name === n) return false;
        if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === n) return false;
        if (ts.isBinaryExpression(parent) && parent.left === n && isAssignment(parent)) return false;
        if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent) || ts.isTemplateSpan(parent)) return false;
        if (ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text.endsWith("Command")
            && (parent.arguments ?? []).some((a) => a === n)) return false;
        if (ts.isImportSpecifier(parent) || ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent)) return false;
        return true; // includes `export { p }` / `export default p`: a file the scan does not read may write it
    }).length > 0;
}

/**
 * True when the scan recognizes that the object or array binding `name`, as seen from `ctx.sf`, may change where it
 * does not look: its declaration has an `export` modifier (in this file, or in the module it is imported from), or
 * `hasUnmodelledUse` reports a use in this file. A separate `export { p }` in the module it is imported from is not
 * checked (F-RESERVED-SCAN-LIMITS). False is not proof that the binding is unchanged.
 */
function mutableElsewhereOrHere(name: string, ctx: Ctx): boolean {
    const found = resolve(name, ctx);
    if (found && found.decls.variables.some((v) => isExported(v))) return true;
    return hasUnmodelledUse(ctx.sf, name);
}

/** A `+=` tail that starts with a separator cannot join a token of the text before it, so it can be checked alone. */
const startsWithSeparator = (t: string) => t === "" || /^[^A-Za-z0-9_\u0000\u0001]/.test(t);

/**
 * The texts the scan derives for a mutable slot (a `let`, or one property of an object): `initial`, plus the value of
 * each recognized `=` write, plus each recognized `+=` tail that starts with a separator. Any other recognized write —
 * a `+=` tail that could join a token, another operator, a destructuring — makes the slot a hole, reported unresolved.
 * A write the scan does not recognize as a write to this slot (through an alias, `this`, a callback parameter) is not
 * seen.
 */
function slotTexts(initial: string[], writes: ts.BinaryExpression[], at: ts.Node, ctx: Ctx): string[] {
    const out = [...initial];
    for (const w of writes) {
        const op = w.operatorToken.kind;
        const value = op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.PlusEqualsToken ? evaluate(w.right, ctx) : undefined;
        if (value === undefined || ts.isObjectLiteralExpression(w.left) || ts.isArrayLiteralExpression(w.left)) return hole(at, ctx);
        if (op === ts.SyntaxKind.PlusEqualsToken && !value.every(startsWithSeparator)) return hole(at, ctx);
        out.push(...value);
    }
    return out.length > 0 ? out : hole(at, ctx);
}

const isExported = (n: ts.Node): boolean =>
    (ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    || (ts.isVariableDeclaration(n) && isExported(n.parent.parent));

type Declarations = { sf: ts.SourceFile; variables: ts.VariableDeclaration[]; functions: ts.SignatureDeclaration[] };

/** Every variable and function declared as `name` in `sf` (several = shadowed in different scopes: all are taken). */
function declarationsIn(sf: ts.SourceFile, name: string): Declarations {
    const variables = descendants(sf, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) as ts.VariableDeclaration[];
    const functions: ts.SignatureDeclaration[] = [
        ...descendants(sf, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name) as ts.FunctionDeclaration[],
        ...variables.map((v) => v.initializer && unwrap(v.initializer))
            .filter((i): i is ts.ArrowFunction | ts.FunctionExpression => !!i && (ts.isArrowFunction(i) || ts.isFunctionExpression(i))),
    ];
    return { sf, variables: variables.filter((v) => !functions.includes(v.initializer as any)), functions };
}

/** The file an `import { name } from "<spec>"` of `sf` points to (relative specifiers and the renderer's `@/`). */
function importedFile(sf: ts.SourceFile, name: string): string | undefined {
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        const bindings = st.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings) || !bindings.elements.some((e) => e.name.text === name)) continue;
        const spec = st.moduleSpecifier.text;
        const base = spec.startsWith(".") ? path.resolve(path.dirname(sf.fileName), spec)
            : spec.startsWith("@/") && sf.fileName.includes("/src/") ? path.join(sf.fileName.slice(0, sf.fileName.indexOf("/src/") + 5), spec.slice(2))
            : undefined;
        if (!base) return undefined;
        const stem = base.replace(/\.js$/, "");
        return [`${stem}.ts`, `${stem}.tsx`, path.join(stem, "index.ts")].find((f) => existsSync(f));
    }
    return undefined;
}

/** Declarations of `name` as seen from `ctx.sf`: local ones, else the imported module's. */
function resolve(name: string, ctx: Ctx): { decls: Declarations; ctx: Ctx } | undefined {
    const local = declarationsIn(ctx.sf, name);
    if (local.variables.length + local.functions.length > 0) return { decls: local, ctx };
    const file = importedFile(ctx.sf, name);
    if (!file) return undefined;
    const inner: Ctx = { ...ctx, sf: parse(file) };
    const remote = declarationsIn(inner.sf, name);
    return remote.variables.length + remote.functions.length > 0 ? { decls: remote, ctx: inner } : undefined;
}

/**
 * When `id` is a parameter of an enclosing function: the argument expressions of each same-file direct call
 * `name(…)` of that function (a call through an alias, `.call` / `.apply` or a callback is not seen). `null` = the
 * scan does not follow this parameter (an unnamed or exported function, or no direct call found). `undefined` = not a
 * parameter.
 */
function parameterArguments(id: ts.Identifier, ctx: Ctx): ts.Expression[] | null | undefined {
    let fn: ts.Node | undefined = id.parent;
    while (fn && !(ts.isFunctionLike(fn) && fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === id.text))) fn = fn.parent;
    if (!fn) return undefined;
    const f = fn as ts.SignatureDeclaration;
    const index = f.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === id.text);
    const owner = ts.isFunctionDeclaration(f) ? f : ts.isVariableDeclaration(f.parent) ? f.parent : undefined;
    const name = owner && ts.isFunctionDeclaration(owner) ? owner.name?.text
        : owner && ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) ? owner.name.text : undefined;
    if (!owner || !name || isExported(owner)) return null;
    const calls = descendants(ctx.sf, (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) as ts.CallExpression[];
    const args = calls.map((c) => c.arguments[index]);
    return args.length > 0 && args.every((a) => a !== undefined && !ts.isSpreadElement(a)) ? args : null;
}

/** The `return` expressions the scan finds in a same-file (or imported) function, returns of nested functions excluded;
 *  `undefined` when the callee is not such a function. */
function returnedExpressions(callee: ts.Expression, ctx: Ctx): { exprs: ts.Expression[]; ctx: Ctx } | undefined {
    if (!ts.isIdentifier(callee)) return undefined;
    const found = resolve(callee.text, ctx);
    if (!found || found.decls.functions.length === 0) return undefined;
    const exprs = found.decls.functions.flatMap((f) => {
        const body = (f as ts.FunctionLikeDeclaration).body;
        if (!body) return [];
        if (!ts.isBlock(body)) return [body];
        const out: ts.Expression[] = [];
        const walk = (n: ts.Node) => {
            if (ts.isFunctionLike(n)) return;
            if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
            ts.forEachChild(n, walk);
        };
        ts.forEachChild(body, walk);
        return out;
    });
    return { exprs, ctx: found.ctx };
}

function evaluateIdentifier(id: ts.Identifier, ctx: Ctx): string[] {
    const args = parameterArguments(id, ctx);
    if (args === null) return hole(id, ctx);
    if (args) return args.flatMap((a) => evaluate(a, ctx));
    const found = resolve(id.text, ctx);
    if (!found || found.decls.variables.length === 0) return hole(id, ctx);
    return found.decls.variables.flatMap((v) => variableTexts(v, found.ctx));
}

/** A `const`: its initializer. A `let`/`var`: a slot — its initializer and the writes to it the scan recognizes in the
 *  file (`slotTexts`). */
function variableTexts(v: ts.VariableDeclaration, ctx: Ctx): string[] {
    const name = v.name as ts.Identifier;
    if ((v.parent.flags & ts.NodeFlags.Const) !== 0) return v.initializer ? evaluate(v.initializer, ctx) : hole(name, ctx);
    const writes = writesTo(ctx.sf, name.text);
    // A write to a member (`p.x = …`) means the binding holds an object, not a text: not modelled.
    if (writes.some((w) => !ts.isIdentifier(w.left) && !ts.isObjectLiteralExpression(w.left) && !ts.isArrayLiteralExpression(w.left))) {
        return hole(name, ctx);
    }
    return slotTexts(v.initializer ? evaluate(v.initializer, ctx) : [], writes, name, ctx);
}

/**
 * The element texts the scan derives for an array expression. The `.join()` resolution treats each element as a whole
 * token group and ignores order and subset; that is wrong when elements are name fragments joined with an empty or
 * name-character separator (`p.unshift("tot"); p.join("")`, F-RESERVED-SCAN-LIMITS).
 */
function arrayElements(node: ts.Expression, ctx: Ctx): string[] | undefined {
    node = unwrap(node);
    const spread = (e: ts.Expression) => (ts.isSpreadElement(e) ? arrayElements(e.expression, ctx) ?? hole(e, ctx) : evaluate(e, ctx));
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(spread);
    if (ts.isConditionalExpression(node)) {
        const [a, b] = [arrayElements(node.whenTrue, ctx), arrayElements(node.whenFalse, ctx)];
        return a && b ? [...a, ...b] : undefined;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "filter") return arrayElements(node.expression.expression, ctx);
        const fn = node.arguments[0] && unwrap(node.arguments[0]);
        if (method === "map" && fn && ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return evaluate(fn.body, ctx);
        return undefined;
    }
    if (ts.isIdentifier(node)) {
        const args = parameterArguments(node, ctx);
        if (args === null) return undefined;
        if (args) {
            const all = args.map((a) => arrayElements(a, ctx));
            return all.every((a) => a !== undefined) ? all.flat() as string[] : undefined;
        }
        const found = resolve(node.text, ctx);
        if (!found || found.decls.variables.length === 0) return undefined;
        // Modelled: a `const` array changed only by recognized dot `push` / `unshift`. A `let`, an `export` modifier, a
        // recognized write (`p[i] = …`) or a use `hasUnmodelledUse` reports makes it unresolved. A change the scan does
        // not recognize (a rest-parameter callback, a parenthesised call) leaves it resolved (F-RESERVED-SCAN-LIMITS).
        if (found.decls.variables.some((v) => (v.parent.flags & ts.NodeFlags.Const) === 0 || isExported(v))) return undefined;
        const sf = found.ctx.sf;
        const methodCalls = descendants(sf, (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === node.text) as ts.CallExpression[];
        const methodOf = (c: ts.CallExpression) => (c.expression as ts.PropertyAccessExpression).name.text;
        if (writesTo(sf, node.text).length > 0 || hasUnmodelledUse(sf, node.text)) return undefined;
        const initial = found.decls.variables.map((v) => (v.initializer ? arrayElements(v.initializer, found.ctx) : []));
        if (initial.some((i) => i === undefined)) return undefined;
        const added = methodCalls.filter((c) => ["push", "unshift"].includes(methodOf(c)));
        return [...(initial.flat() as string[]), ...added.flatMap((c) => c.arguments.flatMap((a) =>
            ts.isSpreadElement(a) ? arrayElements(a.expression, found.ctx) ?? hole(a, found.ctx) : evaluate(a, found.ctx)))];
    }
    return undefined;
}

/** The object literals the scan finds for an expression (literal, `const`, parameter, `?:`, call of a local function). */
type Literal = { obj: ts.ObjectLiteralExpression; ctx: Ctx };

function objectLiterals(node: ts.Expression, ctx: Ctx): Literal[] | undefined {
    node = unwrap(node);
    if (ctx.depth > MAX_DEPTH || ctx.active.has(node)) return undefined;
    ctx.active.add(node);
    const found = objectLiteralsUncached(node, ctx);
    ctx.active.delete(node);
    return found;
}

function objectLiteralsUncached(node: ts.Expression, ctx: Ctx): Literal[] | undefined {
    const inner: Ctx = { ...ctx, depth: ctx.depth + 1 };
    const all = (parts: (Literal[] | undefined)[]) => (parts.every((p) => p !== undefined) ? parts.flat() as Literal[] : undefined);
    if (ts.isObjectLiteralExpression(node)) return [{ obj: node, ctx }];
    if (ts.isConditionalExpression(node)) return all([objectLiterals(node.whenTrue, inner), objectLiterals(node.whenFalse, inner)]);
    if (ts.isCallExpression(node)) {
        const r = returnedExpressions(node.expression, inner);
        return r && r.exprs.length > 0 ? all(r.exprs.map((e) => objectLiterals(e, r.ctx))) : undefined;
    }
    if (ts.isIdentifier(node)) {
        const args = parameterArguments(node, inner);
        if (args === null) return undefined;
        if (args) return all(args.map((a) => objectLiterals(a, inner)));
        const found = resolve(node.text, inner);
        if (!found || found.decls.variables.length === 0) return undefined;
        // A reassignable binding that the file reassigns is not modelled.
        if (found.decls.variables.some((v) => (v.parent.flags & ts.NodeFlags.Const) === 0)
            && writesTo(found.ctx.sf, node.text).some((w) => ts.isIdentifier(w.left))) return undefined;
        return all(found.decls.variables.map((v) => (v.initializer ? objectLiterals(v.initializer, found.ctx) : undefined)));
    }
    const member = memberName(node);
    if (member !== undefined) {
        // A nested object read (`a.b.c`): a recognized write under the root, or a use of it `hasUnmodelledUse` reports, makes it a hole.
        const root = rootIdentifier(node);
        if (root && (writesTo(ctx.sf, root.text).length > 0 || mutableElsewhereOrHere(root.text, ctx))) return undefined;
        const owners = objectLiterals((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression, inner);
        if (!owners) return undefined;
        return all(owners.map(({ obj, ctx: c }) => {
            const p = obj.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(c.sf).replace(/^["'`]|["'`]$/g, "") === member) as ts.PropertyAssignment | undefined;
            return p ? objectLiterals(p.initializer, c) : undefined;
        }));
    }
    return undefined;
}

function evaluate(node: ts.Expression, ctx: Ctx): string[] {
    const known = ctx.memo.get(node);
    if (known) return known;
    if (ctx.depth > MAX_DEPTH || ctx.active.has(node)) return hole(node, ctx);
    ctx.active.add(node);
    const texts = evaluateUncached(unwrap(node), ctx);
    ctx.active.delete(node);
    ctx.memo.set(node, texts);
    return texts;
}

function evaluateUncached(node: ts.Expression, ctx: Ctx): string[] {
    const inner: Ctx = { ...ctx, depth: ctx.depth + 1 };
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
        let texts = [node.head.text];
        for (const span of node.templateSpans) {
            texts = product(product(texts, evaluate(span.expression, inner), node, ctx), [span.literal.text], node, ctx);
        }
        return texts;
    }
    if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        if (op === ts.SyntaxKind.PlusToken) return product(evaluate(node.left, inner), evaluate(node.right, inner), node, ctx);
        if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
            return [...evaluate(node.left, inner), ...evaluate(node.right, inner)];
        }
    }
    if (ts.isConditionalExpression(node)) return [...evaluate(node.whenTrue, inner), ...evaluate(node.whenFalse, inner)];
    if (ts.isIdentifier(node)) return evaluateIdentifier(node, inner);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join") {
        const elements = arrayElements(node.expression.expression, inner);
        if (elements === undefined) return hole(node, ctx);
        const separators = node.arguments[0] ? evaluate(node.arguments[0], inner) : [","];
        // Joining ALL elements once, in source order, shows each element's tokens; it assumes every element is a whole
        // token group. With an empty or name-character separator and `unshift`, elements can join into a name the scan
        // never builds (`p.unshift("tot"); p.join("")` → `total`): a known false-clean form (F-RESERVED-SCAN-LIMITS).
        return separators.map((sep) => elements.join(sep));
    }
    if (ts.isCallExpression(node)) {
        const r = returnedExpressions(node.expression, inner);
        if (r && r.exprs.length > 0) return r.exprs.flatMap((e) => evaluate(e, r.ctx));
    }
    const member = memberName(node);
    if (member !== undefined) return evaluateMember(node as ts.PropertyAccessExpression | ts.ElementAccessExpression, member, ctx);
    return hole(node, ctx);
}

/**
 * `x.member` / `x["member"]`: the property values the scan derives from the object literals it finds for `x`. It
 * reports a hole when `mutableElsewhereOrHere` recognizes that `x` may change elsewhere (an `export` modifier, a use
 * `hasUnmodelledUse` reports); an `x` exported through a separate `export { x }` in the module it is imported from is
 * not detected. Otherwise the property is a slot (`slotTexts`) with the recognized `x.member = …` / `+=` writes of the
 * file; a recognized write to `x[<computed>]` or reassignment of `x` makes it a hole. A deeper chain (`a.b.member`) is
 * a hole as soon as a write under `a` is recognized or a use of `a` is reported.
 */
function evaluateMember(node: ts.PropertyAccessExpression | ts.ElementAccessExpression, member: string, ctx: Ctx): string[] {
    const inner: Ctx = { ...ctx, depth: ctx.depth + 1 };
    const target = unwrap(node.expression);
    let writes: ts.BinaryExpression[] = [];
    const root = rootIdentifier(target);
    if (root) {
        if (mutableElsewhereOrHere(root.text, ctx)) return hole(node, ctx);
        const all = writesTo(ctx.sf, root.text);
        if (ts.isIdentifier(target)) {
            for (const w of all) {
                const left = unwrap(w.left);
                const owner = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left) ? unwrap(left.expression) : undefined;
                const direct = owner !== undefined && ts.isIdentifier(owner) && owner.text === root.text;
                if (!direct) {
                    if (ts.isIdentifier(left) || ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) return hole(node, ctx);
                    continue; // a write deeper under another member (`x.other.y = …`) is not treated as reaching `x.member`
                }
                const name = memberName(left);
                if (name === undefined) return hole(node, ctx); // `x[<computed>] = …` may be `x.member`
                if (name === member) writes.push(w);
            }
        } else if (all.length > 0) {
            return hole(node, ctx);
        }
    }
    const owners = objectLiterals(target, inner);
    if (!owners || owners.length === 0) return hole(node, ctx);
    // An object with a method, a getter / setter or a function-valued property can compute or change `member` in code
    // the scan does not follow (`this.expression = …`, `get expression() {…}`). Only behaviour written in the literal is
    // recognized (a method, an accessor, a function or arrow initializer); a function given through an identifier
    // (`{ join: change }`) is not (F-RESERVED-SCAN-LIMITS).
    const hasBehaviour = (x: ts.ObjectLiteralElementLike) => ts.isMethodDeclaration(x) || ts.isGetAccessorDeclaration(x)
        || ts.isSetAccessorDeclaration(x) || (ts.isPropertyAssignment(x) && (ts.isArrowFunction(unwrap(x.initializer)) || ts.isFunctionExpression(unwrap(x.initializer))));
    if (owners.some(({ obj }) => obj.properties.some(hasBehaviour))) return hole(node, ctx);
    const initial = owners.flatMap(({ obj, ctx: c }) => {
        const p = obj.properties.find((x) => (ts.isPropertyAssignment(x) || ts.isShorthandPropertyAssignment(x))
            && x.name.getText(c.sf).replace(/^["'`]|["'`]$/g, "") === member);
        if (!p) return obj.properties.some((x) => ts.isSpreadAssignment(x) || (ts.isPropertyAssignment(x) && ts.isComputedPropertyName(x.name)))
            ? hole(node, ctx) : [];
        return ts.isPropertyAssignment(p) ? evaluate(p.initializer, c) : evaluateIdentifier((p as ts.ShorthandPropertyAssignment).name, c);
    });
    return slotTexts(initial.length > 0 || writes.length > 0 ? initial : [""], writes, node, inner);
}

/** The texts of a key: a literal, or a computed key the scan resolves fully (no hole); `[]` otherwise. */
function keyTexts(key: ts.Expression, sf: ts.SourceFile): string[] {
    const texts = evaluate(key, { sf, holes: [], depth: 0, memo: new Map(), active: new Set() });
    return texts.some((t) => t.includes("\u0000")) ? [] : texts;
}

/**
 * The expression kind `n` writes, when the scan recognizes `n` as a site: an object property (plain or quoted key, or
 * a computed key the scan resolves), a shorthand property, or an assignment `x.<Kind> = / +=` or
 * `x["<Kind>"] = / +=` (a computed key the scan resolves).
 */
function siteKind(n: ts.Node, sf: ts.SourceFile): ExpressionKind | undefined {
    let names: string[] = [];
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
        const key = n.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) names = [key.text];
        else if (ts.isComputedPropertyName(key)) names = keyTexts(key.expression, sf);
    }
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        const left = unwrap(n.left);
        if (ts.isPropertyAccessExpression(left)) names = [left.name.text];
        else if (ts.isElementAccessExpression(left)) names = keyTexts(left.argumentExpression, sf);
    }
    return names.find((x) => EXPRESSION_KINDS.has(x)) as ExpressionKind | undefined;
}

/**
 * The DynamoDB expression sites the scan recognizes in `file` (see `siteKind`): an object property with a plain or
 * quoted key or a computed key that resolves, a shorthand property, or `x.<Kind>` / `x["<Kind>"]` assigned with `=` /
 * `+=`. A site whose key comes from a value the scan cannot resolve is not found. `text` scans that source instead of
 * the file on disk (tests).
 */
export function scanExpressionSites(file: string, text?: string): ExpressionSite[] {
    const sf = text === undefined ? parse(file)
        : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return descendants(sf, (n) => siteKind(n, sf) !== undefined).map((n) => {
        const kind = siteKind(n, sf)!;
        const ctx: Ctx = { sf, holes: [], depth: 0, memo: new Map(), active: new Set() };
        let texts: string[];
        if (ts.isPropertyAssignment(n)) texts = evaluate(n.initializer, ctx);
        else if (ts.isShorthandPropertyAssignment(n)) texts = evaluateIdentifier(n.name, ctx);
        else {
            const b = n as ts.BinaryExpression;
            texts = evaluate(b.right, ctx);
            // `x.FilterExpression += " AND …"`: the earlier value (read from `x`'s object literal when it has one) + the tail.
            if (b.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) texts = product(evaluate(b.left, ctx), texts, b, ctx);
        }
        const bare = new Set<number>();
        const nonName = new Set<number>();
        for (const t of texts) {
            for (const m of t.matchAll(/([#:][A-Za-z0-9_]*|\[)?\u0000(\d+)\u0001/g)) (m[1] ? nonName : bare).add(Number(m[2]));
        }
        return {
            file,
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            kind,
            texts: [...new Set(texts)],
            unresolved: [...new Set([...bare].map((i) => ctx.holes[i]))],
            nonNameHoles: [...new Set([...nonName].filter((i) => !bare.has(i)).map((i) => ctx.holes[i]))],
        };
    });
}
