import * as path from "node:path";
import { isInsideDirectory } from "./decisions.js";
import type { Ports } from "./run.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Files", safety rows S5, S16; review-0 F01 and F02; PROTOTYPE) — the file side of
 * the commerce-private table tool: `Ports.files` over a file system that is passed in.
 *
 * It is its own module, and not part of the entry file, because it carries two safety rules, and a rule that is not
 * under a test is not a rule:
 *
 *  1. A LINE IS ON DISK, WHOLE, BEFORE `appendLine` RETURNS. The operating system may accept fewer bytes than it was
 *     given (`writeSync` returns the count). The loop writes until every UTF-8 byte of the line is accepted, stops with
 *     an error when a write accepts nothing, then flushes (`fsync`). The caller sends the delete of an item only after
 *     this returned; any error here means: no delete.
 *  2. A FILE THE TOOL CREATES IS NEVER INSIDE THE REPOSITORY AND NEVER REPLACES A FILE. The directory of the file is
 *     resolved through every link (`realpath`) and compared, by path component, with the resolved repository root — so
 *     a directory outside the repository that is a link into it is refused too. The file is created with the flag
 *     `wx`: the open fails if anything is at that path (a link included). The same check runs twice: when the shell
 *     asks before it reads a table (`outputRefusal`), and again at the moment of creation.
 *
 * The inventory, the manifest and the export hold keys that contain email addresses; the export holds whole items.
 */

/** The seven calls this module needs from `node:fs`; the unit tests pass a double (short writes, failures). */
export type FileSystem = {
    existsSync(file: string): boolean;
    readFileSync(file: string, encoding: "utf8"): string;
    /** The path with every symbolic link resolved. Throws when the path does not exist. */
    realpathSync(file: string): string;
    /** Opens with the given flag; `wx` creates the file and fails if the path exists. */
    openSync(file: string, flags: "wx"): number;
    /** Writes `length` bytes of `buffer` from `offset`; returns how many bytes were accepted (can be fewer). */
    writeSync(descriptor: number, buffer: Uint8Array, offset: number, length: number): number;
    fsyncSync(descriptor: number): void;
    closeSync(descriptor: number): void;
};

/** A write accepted no byte: the text is not on disk, and repeating the call would never end. */
export class IncompleteWrite extends Error {
    name = "IncompleteWrite";
}

/** The file may not be created: its real directory is inside the repository, is missing, or a file is there. */
export class OutputRefused extends Error {
    name = "OutputRefused";
}

/** Every byte of `text` (UTF-8) accepted by the file, then flushed to disk. Throws on an error or on no progress. */
function writeAllAndFlush(fs: FileSystem, descriptor: number, text: string): void {
    const bytes = Buffer.from(text, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
        const accepted = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
        if (!Number.isInteger(accepted) || accepted <= 0) throw new IncompleteWrite(`${offset} of ${bytes.length} bytes written`);
        offset += accepted;
    }
    fs.fsyncSync(descriptor);
}

/** The real `Ports.files`. `repositoryRoot` is the tree no file may be created in. */
export function filesOn(fs: FileSystem, repositoryRoot: string): Ports["files"] {
    /** Why no file may be created at `file`, or `undefined`. Uses real paths, so links cannot hide the repository. */
    const outputRefusal = (file: string): string | undefined => {
        let realDirectory: string;
        try {
            realDirectory = fs.realpathSync(path.dirname(file));
        } catch {
            return `its directory does not exist (${path.dirname(file)}): create the directory first`;
        }
        let realRoot: string;
        try {
            realRoot = fs.realpathSync(repositoryRoot);
        } catch {
            return `the repository root cannot be resolved (${repositoryRoot}), so the tool cannot tell that the file is outside it`;
        }
        if (isInsideDirectory(realRoot, path.join(realDirectory, path.basename(file)))) {
            return `it is inside the repository (${realRoot}; its real directory is ${realDirectory}): give a path outside it; the file holds keys that contain email addresses`;
        }
        if (fs.existsSync(file)) return "the file exists already: the tool never overwrites a file; give a new path";
        return undefined;
    };
    const create = (file: string): number => {
        const refusal = outputRefusal(file);
        if (refusal !== undefined) throw new OutputRefused(`cannot create ${file}: ${refusal}`);
        return fs.openSync(file, "wx");
    };
    return {
        outputRefusal,
        read: (file) => fs.readFileSync(file, "utf8"),
        createNew: (file, text) => {
            const descriptor = create(file);
            try {
                writeAllAndFlush(fs, descriptor, text);
            } finally {
                fs.closeSync(descriptor);
            }
        },
        openNewForAppend: (file) => {
            const descriptor = create(file);
            return {
                appendLine: (line) => writeAllAndFlush(fs, descriptor, `${line}\n`),
                close: () => fs.closeSync(descriptor),
            };
        },
    };
}
