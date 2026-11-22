import { useState } from "react"
import { signIn, confirmSignIn } from 'aws-amplify/auth'; // Import confirmSignIn
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

/*
 * SCHED-1E2 (docs/slices/sched-1.md § 23.5): the return path after sign-in. The guard in App.tsx sends a signed-out
 * user to `/login?next=<path and query>`; after a successful sign-in (password, and the new-password step) the page
 * goes to `next` when `isSafeReturnPath` accepts it, else to `/` as before. Without `next` nothing changes.
 */

/**
 * § 23.5 — one rule for the class "the string must not be able to name another origin": a path only; it starts with
 * exactly one `/`; no `//` and no `\` anywhere (browsers read `\` as `/`, so `/\evil.example` is `//evil.example`);
 * no control or whitespace character; at most 2000 characters. A string that starts with `/` has no scheme. The page
 * goes there with the router's in-app `navigate`, never `window.location`.
 */
export function isSafeReturnPath(p: string): boolean {
    if (p.length === 0 || p.length > 2000) return false;
    if (p[0] !== "/") return false;
    if (p.includes("//") || p.includes("\\")) return false;
    for (const ch of p) {
        const code = ch.codePointAt(0) ?? 0;
        if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(ch)) return false;
    }
    return true;
}

/** Where a successful sign-in goes: `next` (already decoded from the query) when safe, else `/`. */
export function afterSignInPath(next: string | null): string {
    return next !== null && isSafeReturnPath(next) ? next : "/";
}

/** The guard's redirect for a signed-out user: the login page with the requested path and query as `next`. */
export function loginPathFor(pathname: string, search: string): string {
    return `/login?next=${encodeURIComponent(pathname + search)}`;
}

export default function LoginPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState<'LOGIN' | 'NEW_PASSWORD'>('LOGIN');

    // Form State
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");

    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnPath = afterSignInPath(searchParams.get("next"));

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        try {
            const { isSignedIn, nextStep } = await signIn({
                username: email,
                password: password,
            });

            if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
                setStep('NEW_PASSWORD');
            } else if (isSignedIn) {
                navigate(returnPath);
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Failed to login");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleNewPassword(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        try {
            const { isSignedIn } = await confirmSignIn({
                challengeResponse: newPassword
            });

            if (isSignedIn) {
                navigate(returnPath);
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Failed to set new password");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-4xl font-serif text-cyan-600 font-medium text-center">
                        AMODX
                    </CardTitle>
                    <CardDescription className="text-center">
                        {step === 'LOGIN'
                            ? "Enter your credentials to access the cockpit"
                            : "Please set a new secure password"}
                    </CardDescription>
                </CardHeader>

                {step === 'LOGIN' ? (
                    <form onSubmit={handleLogin}>
                        <CardContent className="space-y-4">
                            {error && (
                                <div className="p-3 text-sm text-white bg-red-500 rounded-md">
                                    {error}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="admin@agency.com"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full" type="submit" disabled={isLoading}>
                                {isLoading ? "Signing in..." : "Sign in"}
                            </Button>
                        </CardFooter>
                    </form>
                ) : (
                    <form onSubmit={handleNewPassword}>
                        <CardContent className="space-y-4">
                            {error && (
                                <div className="p-3 text-sm text-white bg-red-500 rounded-md">
                                    {error}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="new-password">New Password</Label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    required
                                    minLength={8}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Must be at least 8 characters"
                                />
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full" type="submit" disabled={isLoading}>
                                {isLoading ? "Setting Password..." : "Set Password & Login"}
                            </Button>
                        </CardFooter>
                    </form>
                )}
            </Card>
        </div>
    );
}
