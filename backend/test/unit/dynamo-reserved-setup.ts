import { vi } from "vitest";

/**
 * PROJECTION-RESERVED-1 — a `setupFiles` entry of `vitest.unit.config.ts`: every unit test file gets the real
 * `@aws-sdk/lib-dynamodb` module passed through `guardCommandClasses` (`dynamo-expression-guard.ts`), so each
 * expression-carrying command class is a same-named subclass whose constructor first calls
 * `assertNoBareReservedWord(input)`. A handler that builds a command with a bare reserved word in an expression
 * therefore throws DynamoDB's ValidationException inside its own `try`, whatever test double receives the command
 * (MemoryTable, LangTable, a `vi.fn` mock, aws-sdk-client-mock).
 *
 * Why the constructor and not each double's `send`: the doubles are not one module (in-memory tables, ~40 ad-hoc
 * `vi.fn` mocks, 13 aws-sdk-client-mock files), so one interception point covers them all with no edit to any of them.
 * A test file that replaces `@aws-sdk/lib-dynamodb` with its own `vi.mock` factory replaces this mock for that file;
 * such a factory must return its module through `guardCommandClasses` too (today: debounce-flush, debounce-maxwait,
 * invalidate-cdn, lang-1b-deferred-flush). `projection-reserved-1.test.ts` fails on a factory that does not.
 */
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const { guardCommandClasses } = await import("./dynamo-expression-guard.js");
    return guardCommandClasses(await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>());
});
