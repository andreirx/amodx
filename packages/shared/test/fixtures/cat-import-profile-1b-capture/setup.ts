// CAT-IMPORT-PROFILE-1B golden capture — after each test file, its records are written to $CAPTURE_DIR/<file>.json.
import { afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { expect } from "vitest";
import { bases, facetCalls, valuesCalls } from "./recorder";

afterAll(() => {
    const file = basename(expect.getState().testPath ?? "unknown");
    writeFileSync(`${process.env.CAPTURE_DIR}/${file}.records.json`, JSON.stringify({ bases, facetCalls, valuesCalls }));
});
