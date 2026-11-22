"use client";
// SCHED-1G2 (review-0 finding S1G2-R1) — ONE lifetime rule for every write and every write-related read of the
// booking pages (hold, resend, confirm, cancel, move):
//   1. at most one runs at a time: `run` refuses to start while another is pending, and `busy` is true meanwhile —
//      every control that can start a write or change the screen (top-level buttons AND picker buttons) is disabled
//      while `busy`;
//   2. an answer is applied only to the screen it was started for: `invalidate()` (called on every navigation) and
//      unmount move the epoch, and an answer that comes back for an older epoch is dropped.
// The pickers' own reads (free times, groups) follow the same rule 2 through their effect cleanup (`live` flag): the
// answer of an earlier week or filter never replaces the current one.
//
// Abstraction line: users — the book flow (hold, resend) and the manage view (confirm, cancel, move); axis: none (one
// rule); rejected: a `busy` flag and an "is this still current" test written separately in each handler (the
// review-0 defects were exactly two handlers where one half was missing).
import { useCallback, useEffect, useRef, useState } from "react";

export type Operation = {
    busy: boolean;
    /** Starts `start` unless another operation is pending; `apply` gets its result only if the epoch is unchanged. */
    run: <T>(start: () => Promise<T>, apply: (result: T) => void) => Promise<void>;
    /** Drops the answer of any pending operation (navigation to another screen). */
    invalidate: () => void;
};

export function useOperation(): Operation {
    const epoch = useRef(0);
    const pending = useRef(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => () => { epoch.current += 1; }, []);
    const invalidate = useCallback(() => { epoch.current += 1; }, []);
    const run = useCallback(async <T,>(start: () => Promise<T>, apply: (result: T) => void) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        const startedIn = epoch.current;
        try {
            const result = await start();
            if (epoch.current === startedIn) apply(result);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }, []);
    return { busy, run, invalidate };
}
