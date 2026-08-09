/**
 * TEST-5 support — resolve a DEPLOYED-STAGING execution context for the review round-trip e2e.
 *
 * WHAT THIS IS. A single earned helper (one caller: review-flow.spec.ts) that does the two things
 * the spec cannot do over plain HTTP: (1) mint a real Cognito ADMIN id-token carrying an `email`
 * claim + `custom:role=GLOBAL_ADMIN`, and (2) hand back every STAGING resource id the spec's direct
 * AWS assertions/cleanup need — table, private + public buckets, CDN, API URL. It exists as its own
 * module, not inline in the spec, because it crosses the AWS/Cognito boundary and carries the
 * prod/staging SAFETY assertions below; keeping that out of the test body keeps the spec readable and
 * the guards in one auditable place. Axis of variation: none claimed — it is not an abstraction over
 * a growth axis, just extraction of boundary-crossing setup. Simpler alternative rejected: inlining
 * it in beforeAll (mixes ~120 lines of Cognito/CFN plumbing + safety guards into the test flow).
 *
 * WHY A TOKEN AT ALL (the gap TEST-5 closes). The bulk-import handler (backend/src/import/reviews.ts)
 * FAILS CLOSED on identity: the master-key/robot GLOBAL_ADMIN context has no `email`, so it is 403'd
 * ("cannot attest an import"). The existing e2e specs authenticate with the master key — which is
 * exactly why they could never exercise this flow. So we must present a REAL user id-token whose
 * `email` claim the authorizer copies into `auth.email` (backend/src/auth/authorizer.ts reads
 * `(payload as any).email` off the verified id-token). `admin@staging.amodx.net` is that user.
 *
 * ── PROD/STAGING SAFETY (this repo runs prod + staging in ONE AWS account, resources suffixed
 *    `-staging`; ambient creds here are account-admin). Every id this helper returns is resolved from
 *    the `AmodxStack-staging` CloudFormation outputs and HARD-CHECKED before use:
 *      • the CFN StackId's account segment must equal amodx.staging.json's `account`;
 *      • the stack Region output must equal amodx.staging.json's `region`;
 *      • `.env.test`'s ADMIN_API_URL host must equal the stack's Api URL host, and its TABLE_NAME
 *        must equal the stack's TableName output — i.e. `.env.test` provably points at THIS staging
 *        stack, not prod (prod has a different Api host + a different table name).
 *    Any mismatch THROWS before a single mutating call — so a misconfiguration can never silently
 *    drive the round-trip against production.
 *
 * ── TOKEN APPROACH = ratified fallback (A) (TEST-5 step 1b "decide in-slice, record which").
 *    The staging admin app-client is SRP-only (authFlows.userSrp). A headless one-shot cannot
 *    reliably drive the admin SPA's SRP login DOM (the slice's "too brittle" case), and Node-side SRP
 *    would add a dependency outside this slice's writable surface. So: temporarily add
 *    ALLOW_ADMIN_USER_PASSWORD_AUTH to the STAGING app-client, AdminInitiateAuth, and REVERT the
 *    client's ExplicitAuthFlows to its EXACT prior set in a `finally`. The full client config is
 *    round-tripped (UpdateUserPoolClient REPLACES omitted fields), so nothing but the flow list ever
 *    changes, and only for the few hundred ms of the mint. Idempotent + self-reverting + documented.
 *
 * SECRET HYGIENE: this module NEVER logs the token, password, api key, or client secret. Callers get
 * the token as an opaque string to put in an Authorization header.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import {
    CloudFormationClient,
    DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
    CognitoIdentityProviderClient,
    AdminGetUserCommand,
    AdminUpdateUserAttributesCommand,
    DescribeUserPoolClientCommand,
    UpdateUserPoolClientCommand,
    AdminInitiateAuthCommand,
    type UserPoolClientType,
    type UpdateUserPoolClientCommandInput,
    type ExplicitAuthFlowsType,
} from "@aws-sdk/client-cognito-identity-provider";

const STAGING_STACK = "AmodxStack-staging";
const PASSWORD_FLOW: ExplicitAuthFlowsType = "ALLOW_ADMIN_USER_PASSWORD_AUTH";

/**
 * TEST-5 HARD CONTRACT: this helper may only ever authenticate as — and elevate
 * `custom:role=GLOBAL_ADMIN` on — the ONE mandated staging admin. A misconfigured CI secret
 * (`TEST_ADMIN_USER`) must not be able to point the mint/elevation at any other staging user.
 * Enforced twice below, both BEFORE the first mutating call: (1) the configured username, and
 * (2) the Cognito-returned `email` claim, must both equal this address. Compared lower-cased.
 */
const MANDATED_ADMIN_EMAIL = "admin@staging.amodx.net";

/** CloudFormation output logical-id suffixes are CDK-hashed; match by the stable prefix. */
const OUTPUT_KEYS = {
    adminPoolId: "AdminPoolId",
    adminClientId: "AdminClientId",
    tableName: "TableName",
    region: "Region",
    apiUrl: "ApiApiUrl",
    privateBucket: "UploadsPrivateBucketName",
    publicBucket: "UploadsAssetsBucketName",
    cdnUrl: "UploadsAssetsCdnUrl",
} as const;

export interface StagingContext {
    region: string;
    account: string;
    /** Admin API base URL (proven === the staging stack's Api URL). No trailing slash. */
    apiUrl: string;
    tableName: string;
    privateBucket: string;
    publicBucket: string;
    /** Public asset CDN base (no trailing slash). */
    cdnUrl: string;
    /** The admin's email — this is what the import handler records as `attestedBy`. */
    adminEmail: string;
    /** Opaque Cognito ADMIN id-token. NEVER log this. Put it in `Authorization: Bearer <token>`. */
    idToken: string;
}

function repoRoot(): string {
    // tests/e2e/support/ → repo root is three levels up.
    return path.resolve(__dirname, "..", "..", "..");
}

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v || v.trim() === "") throw new Error(`TEST-5: missing ${name} in .env.test`);
    return v.trim();
}

function hostOf(url: string): string {
    return new URL(url).host;
}

function findOutput(outputs: { OutputKey?: string; OutputValue?: string }[], prefix: string): string {
    const hit = outputs.find((o) => (o.OutputKey ?? "").startsWith(prefix));
    if (!hit?.OutputValue) throw new Error(`TEST-5: ${STAGING_STACK} has no output starting "${prefix}"`);
    return hit.OutputValue;
}

/**
 * Rebuild an UpdateUserPoolClient input from a described client, changing only ExplicitAuthFlows.
 * UpdateUserPoolClient REPLACES the client, so every writable field of the described client is copied
 * back verbatim; the read-only fields (ClientSecret, LastModifiedDate, CreationDate) are destructured
 * out so nothing but the auth-flow list changes. `UserPoolId`/`ClientId` are the required keys on
 * UpdateUserPoolClientCommandInput but OPTIONAL on UserPoolClientType, so they are supplied explicitly
 * from the already-safety-verified stack outputs — this makes the return properly typed with no cast.
 */
function updateInputFrom(
    desc: UserPoolClientType,
    poolId: string,
    clientId: string,
    flows: ExplicitAuthFlowsType[],
): UpdateUserPoolClientCommandInput {
    const { ClientSecret: _cs, LastModifiedDate: _lmd, CreationDate: _cd, ...writable } = desc;
    return {
        ...writable,
        UserPoolId: poolId,
        ClientId: clientId,
        ExplicitAuthFlows: flows,
    };
}

/**
 * Resolve staging ids + mint the admin id-token. Throws (before any mutation) on any prod/staging
 * safety mismatch. `log` receives redaction-safe progress lines for the spec's transcript.
 */
export async function resolveStagingContext(log: (m: string) => void = () => {}): Promise<StagingContext> {
    dotenv.config({ path: path.join(repoRoot(), ".env.test") });

    // Expected account/region come from the checked-in staging config — the source of truth for
    // "what staging is", independent of ambient creds.
    const stagingCfg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "amodx.staging.json"), "utf8"));
    const expectAccount: string = String(stagingCfg.account);
    const expectRegion: string = String(stagingCfg.region);

    const cfn = new CloudFormationClient({ region: expectRegion });
    const stacks = await cfn.send(new DescribeStacksCommand({ StackName: STAGING_STACK }));
    const stack = stacks.Stacks?.[0];
    if (!stack) throw new Error(`TEST-5: stack ${STAGING_STACK} not found`);

    // GUARD 1: the stack we just read really belongs to the staging account.
    const stackAccount = (stack.StackId ?? "").split(":")[4];
    if (stackAccount !== expectAccount) {
        throw new Error(`TEST-5 SAFETY: ${STAGING_STACK} account ${stackAccount} != staging ${expectAccount}`);
    }
    const outputs = stack.Outputs ?? [];
    const region = findOutput(outputs, OUTPUT_KEYS.region);
    if (region !== expectRegion) {
        throw new Error(`TEST-5 SAFETY: stack Region ${region} != staging ${expectRegion}`);
    }

    const adminPoolId = findOutput(outputs, OUTPUT_KEYS.adminPoolId);
    const adminClientId = findOutput(outputs, OUTPUT_KEYS.adminClientId);
    const stackTable = findOutput(outputs, OUTPUT_KEYS.tableName);
    const stackApiUrl = findOutput(outputs, OUTPUT_KEYS.apiUrl).replace(/\/+$/, "");
    const privateBucket = findOutput(outputs, OUTPUT_KEYS.privateBucket);
    const publicBucket = findOutput(outputs, OUTPUT_KEYS.publicBucket);
    const cdnUrl = findOutput(outputs, OUTPUT_KEYS.cdnUrl).replace(/\/+$/, "");

    // GUARD 2: .env.test must provably point at THIS staging stack (not prod).
    const envApiUrl = requireEnv("ADMIN_API_URL").replace(/\/+$/, "");
    const envTable = requireEnv("TABLE_NAME");
    if (hostOf(envApiUrl) !== hostOf(stackApiUrl)) {
        throw new Error(`TEST-5 SAFETY: .env ADMIN_API_URL host ${hostOf(envApiUrl)} != staging Api host ${hostOf(stackApiUrl)}`);
    }
    if (envTable !== stackTable) {
        throw new Error(`TEST-5 SAFETY: .env TABLE_NAME "${envTable}" != staging TableName "${stackTable}"`);
    }
    log(`[safety] verified staging: account=${expectAccount} region=${region} table=${stackTable}`);
    log(`[safety] .env.test ADMIN_API_URL + TABLE_NAME match ${STAGING_STACK} (prod has distinct ids)`);

    const user = requireEnv("TEST_ADMIN_USER");
    const password = requireEnv("TEST_ADMIN_PASSWORD");

    // GUARD 3a (identity): the configured username MUST be the mandated staging admin. This is the
    // first line of defence against a mis-set CI secret elevating/authenticating another user; it
    // runs BEFORE the AdminGetUser lookup and every mutating call below. Value is not echoed.
    if (user.trim().toLowerCase() !== MANDATED_ADMIN_EMAIL) {
        throw new Error(`TEST-5 SAFETY: TEST_ADMIN_USER must be ${MANDATED_ADMIN_EMAIL} (reuse the mandated admin; no other/new account)`);
    }

    const cognito = new CognitoIdentityProviderClient({ region });

    // Step 1a — ensure custom:role=GLOBAL_ADMIN (idempotent). Left set: this IS the test admin's
    // intended, documented staging role.
    const got = await cognito.send(new AdminGetUserCommand({ UserPoolId: adminPoolId, Username: user }));
    const attrs = got.UserAttributes ?? [];

    // GUARD 3b (identity): the account's ACTUAL Cognito `email` attribute must be PRESENT and equal to
    // the mandated admin — NO fallback to the configured username. Why the fallback (`?? user`) was a
    // hole: the import handler attests on `auth.email`, which the authorizer copies from the id-token's
    // `email` claim, which Cognito populates from THIS attribute. If the account has no `email`
    // attribute, the minted token carries no usable email claim (the import gate would then 403, or —
    // worse — attest to a wrong identity); substituting the username masked that. So an ABSENT or
    // MISMATCHED email must fail closed HERE, before the AdminUpdateUserAttributes elevation and the
    // token mint. AdminGetUser is a read, so this still precedes every mutating/authenticating call.
    const emailAttr = attrs.find((a) => a.Name === "email")?.Value?.trim();
    if (!emailAttr) {
        throw new Error(`TEST-5 SAFETY: staging admin has no Cognito 'email' attribute — refusing to elevate or authenticate (the import attestation identity gate requires a real email claim)`);
    }
    if (emailAttr.toLowerCase() !== MANDATED_ADMIN_EMAIL) {
        throw new Error(`TEST-5 SAFETY: resolved Cognito email is not ${MANDATED_ADMIN_EMAIL} — refusing to elevate or authenticate another user`);
    }
    const adminEmail = emailAttr;

    const currentRole = attrs.find((a) => a.Name === "custom:role")?.Value;
    if (currentRole !== "GLOBAL_ADMIN") {
        await cognito.send(new AdminUpdateUserAttributesCommand({
            UserPoolId: adminPoolId,
            Username: user,
            UserAttributes: [{ Name: "custom:role", Value: "GLOBAL_ADMIN" }],
        }));
        log(`[setup] custom:role set GLOBAL_ADMIN (was ${currentRole ?? "unset"})`);
    } else {
        log(`[setup] custom:role already GLOBAL_ADMIN`);
    }

    // Step 1b — mint id-token via the enable→auth→REVERT dance.
    const orig = (await cognito.send(
        new DescribeUserPoolClientCommand({ UserPoolId: adminPoolId, ClientId: adminClientId }),
    )).UserPoolClient;
    if (!orig) throw new Error("TEST-5: could not describe admin app-client");
    const origFlows = orig.ExplicitAuthFlows ?? [];
    const needEnable = !origFlows.includes(PASSWORD_FLOW);

    let idToken: string | undefined;
    try {
        if (needEnable) {
            await cognito.send(new UpdateUserPoolClientCommand(updateInputFrom(orig, adminPoolId, adminClientId, [...origFlows, PASSWORD_FLOW])));
            log(`[token] temporarily enabled ${PASSWORD_FLOW} on staging app-client`);
        }
        const auth = await cognito.send(new AdminInitiateAuthCommand({
            UserPoolId: adminPoolId,
            ClientId: adminClientId,
            AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
            AuthParameters: { USERNAME: user, PASSWORD: password },
        }));
        if (auth.ChallengeName) {
            throw new Error(`TEST-5: auth returned challenge ${auth.ChallengeName} — the test admin needs a permanent password / confirmation before this suite can run`);
        }
        idToken = auth.AuthenticationResult?.IdToken;
        if (!idToken) throw new Error("TEST-5: AdminInitiateAuth returned no IdToken");
    } finally {
        if (needEnable) {
            // REVERT to the exact prior flow set, whatever happened above.
            await cognito.send(new UpdateUserPoolClientCommand(updateInputFrom(orig, adminPoolId, adminClientId, origFlows)));
            const after = (await cognito.send(
                new DescribeUserPoolClientCommand({ UserPoolId: adminPoolId, ClientId: adminClientId }),
            )).UserPoolClient?.ExplicitAuthFlows ?? [];
            const reverted = after.length === origFlows.length && origFlows.every((f) => after.includes(f));
            log(`[token] reverted app-client auth flows to prior set: ${reverted ? "VERIFIED" : "MISMATCH — CHECK MANUALLY"}`);
            if (!reverted) throw new Error(`TEST-5 SAFETY: failed to revert app-client ExplicitAuthFlows (now ${JSON.stringify(after)})`);
        }
    }
    log(`[token] minted admin id-token for ${adminEmail} (GLOBAL_ADMIN) — value redacted`);

    return {
        region,
        account: expectAccount,
        apiUrl: envApiUrl,
        tableName: stackTable,
        privateBucket,
        publicBucket,
        cdnUrl,
        adminEmail,
        idToken,
    };
}
