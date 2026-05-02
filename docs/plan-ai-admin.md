# AI Assistant for Admin Editors — Implementation Plan

**Status:** PLANNED  
**Created:** 2026-05-02  
**Module Type:** SUPPORT (capability registry + gateway) + FEATURE (admin integration)

---

## Problem Statement

Editors need AI assistance within the admin interface. The existing MCP server (`tools/mcp-server/`) provides 45 tools for Claude Desktop, but:

1. MCP uses master API key — wrong security model for tenant editors
2. MCP tool definitions drift from backend reality (e.g., `search_web` reads Brave key from `/settings`, but backend now redacts `integrations.braveApiKey` via `settings-secrets.ts`)
3. Direct browser-to-provider calls expose API keys, bypass cost control, and create no audit trail
4. Editors work with unsaved draft state — backend `PUT` routes would clobber unsaved work

---

## Architectural Target

**MATURE target: One capability registry, multiple adapters.**

**PROTOTYPE reality: Two registries with accepted drift.**

PROTOTYPE ships a backend-owned registry (`backend/src/ai/tool-registry.ts`) serving the admin-chat surface only. The existing MCP server (`tools/mcp-server/src/index.ts`) remains unchanged and continues to drift. This is intentional staging: admin AI delivers value without blocking on MCP refactor. Drift is tolerable short-term because MCP is operator-facing (Claude Desktop) while admin-chat is editor-facing — different user populations, different trust models.

MATURE consolidates: MCP becomes a thin adapter over the shared backend registry. At that point, the diagram below becomes accurate.

```
MATURE STATE (not prototype):

┌─────────────────────────────────────────────────────────────────┐
│                    STABLE CAPABILITY LAYER                       │
│  (backend/src/ai/tool-registry.ts)                              │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Tool Schema  │  │  Tool ACL    │  │ Surface Tags │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Exec Mode    │  │   Handler    │                             │
│  └──────────────┘  └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Admin AI      │    │ MCP Adapter   │    │ Provider      │
│ Adapter       │    │ (Claude       │    │ Adapter       │
│ (browser +    │    │  Desktop)     │    │ (OpenAI/      │
│  backend)     │    │               │    │  Anthropic)   │
└───────────────┘    └───────────────┘    └───────────────┘
     VOLATILE             VOLATILE             VOLATILE
```

---

## Tool Classification

### Class 1: Admin-Safe Backend Tools

Execute in backend Lambda. Return data to model.

| Tool | Endpoint | Notes |
|------|----------|-------|
| `list_content` | GET /content | Read-only |
| `read_page` | GET /content/{id} | Read-only |
| `list_products` | GET /products | Read-only |
| `list_assets` | GET /assets | Read-only |
| `list_tags` | derived | Read-only |
| `list_forms` | GET /forms | Read-only |
| `list_popups` | GET /popups | Read-only |
| `list_signals` | GET /signals | Read-only |
| `list_context` | GET /context | Read-only |
| `read_context` | GET /context/{id} | Read-only |
| `search_web` | Brave API (via backend) | Requires tenant Brave key |
| `scrape_url` | HTTP GET + cheerio | Backend executes |

Write-capable backend tools (require confirmation gate):

| Tool | Endpoint | Confirmation | Surface Condition |
|------|----------|--------------|-------------------|
| `create_page` | POST /content | Show preview | Always available |
| `create_product` | POST /products | Show preview | Always available |
| `create_context` | POST /context | Show preview | Always available |
| `save_signal` | POST /signals | Show preview | Always available |

**Excluded from admin-chat surface:**

| Tool | Endpoint | Reason |
|------|----------|--------|
| `update_page` | PUT /content/{id} | Draft-clobber hazard. On content editor, page writes MUST go through local draft tools (`patch_page_state`), then user saves via existing flow. Backend `update_page` remains available to MCP (which operates on persisted state, not open editors). |
| `update_product` | PUT /products/{id} | Same hazard on product editor. Use `patch_product_form` locally. |
| `update_context` | PUT /context/{id} | Same hazard on strategy editor. |

This separation enforces the draft-safety invariant: AI never overwrites unsaved local state through backend routes.

### Class 2: Admin-Safe Local Draft Tools

Execute in admin browser runtime. Mutate local unsaved state.

| Tool | Target | Notes |
|------|--------|-------|
| `rewrite_selected_text` | ContentEditor selection | Returns replacement text |
| `generate_block` | ContentEditor | Returns block DTO for insertion |
| `patch_page_state` | ContentEditor | Merges into unsaved blocks |
| `suggest_seo` | ContentEditor / ProductEditor | Returns title/description |
| `patch_product_form` | ProductEditor | Merges into form state |
| `translate_block` | ContentEditor | Returns translated block DTO |

These tools receive context DTOs from page context adapters. They return patches. The admin UI applies patches to local state. The user saves via existing flows.

#### Block Patch DTO Format

Tiptap block arrays are ordered, schema-sensitive JSON. A naive "merge" is underspecified. Patch operations must be explicit:

```typescript
interface BlockPatch {
  // Target identification
  targetBlockId?: string;          // UUID of existing block (for replace/delete/move)
  targetIndex?: number;            // Fallback if no blockId match
  
  // Operation
  op: 'insert' | 'replace' | 'delete' | 'move' | 'updateAttrs';
  
  // Payload (depends on op)
  block?: Block;                   // For insert/replace: full block DTO
  attrs?: Partial<BlockAttrs>;     // For updateAttrs: partial attrs merge
  toIndex?: number;                // For move: destination index
  
  // Conflict detection
  expectedContentHash?: string;    // Hash of block content at read time
}

interface DraftPatch {
  patches: BlockPatch[];
  metadata?: {
    title?: string;
    slug?: string;
    seoTitle?: string;
    seoDescription?: string;
  };
}
```

**Conflict handling:** If `expectedContentHash` is provided and does not match current block state, the patch is rejected with a conflict error. The AI must re-read context and retry.

**Ordering:** Patches apply in array order. Insert/delete operations adjust subsequent indices. Move operations are atomic repositions.

### Class 3: MCP-Only Tools

Require local machine capabilities. Not exposed to admin chat.

| Tool | Reason |
|------|--------|
| `social_login` | Playwright browser automation |
| `post_social` | Playwright browser automation |

### Class 4: Never Expose to Editor Chat

| Tool/Endpoint | Reason |
|---------------|--------|
| `settings-secrets.ts` | Raw key material |
| `create_tenant` | Global operator scope |
| Any cross-tenant query | Tenant isolation |

---

## Execution Topology

**Hybrid model with server-side model + split tool execution.**

```
┌─────────────────────────────────────────────────────────────────┐
│                         ADMIN BROWSER                            │
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────────┐ │
│  │ AI Drawer      │◄──►│ Local Draft    │◄──►│ Page Context  │ │
│  │ (chat UI)      │    │ Tool Executor  │    │ Adapters      │ │
│  └───────┬────────┘    └────────────────┘    └───────────────┘ │
│          │                     ▲                                 │
│          │ messages            │ tool results (local)           │
│          ▼                     │                                 │
└──────────┼─────────────────────┼─────────────────────────────────┘
           │                     │
           ▼                     │
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND LAMBDA                           │
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────────┐ │
│  │ /ai/chat       │───►│ Orchestrator   │───►│ LlmGateway    │ │
│  │ handler        │    │                │    │ (OpenAI)      │ │
│  └────────────────┘    └───────┬────────┘    └───────────────┘ │
│                                │                                 │
│                    ┌───────────┴───────────┐                    │
│                    ▼                       ▼                    │
│           ┌────────────────┐      ┌────────────────┐           │
│           │ Backend Tool   │      │ Return to      │           │
│           │ Executor       │      │ browser for    │           │
│           │ (persisted)    │      │ local tool     │           │
│           └────────────────┘      └────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. Browser sends `POST /ai/chat` with messages + page context DTO
2. Backend calls LLM via `LlmGateway`
3. LLM returns `tool_calls`
4. Backend checks tool execution mode:
   - `backend`: execute in Lambda, feed result back to LLM
   - `admin-local`: return to browser with tool request
5. Browser executes local draft tools, sends results back
6. Loop continues until LLM produces final text response
7. Backend returns final response (streaming if enabled)

---

## Tool Registry Schema

Each tool definition:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  
  // Policy
  allowedSurfaces: ('mcp' | 'admin-chat' | 'admin-inline')[];
  executionMode: 'backend' | 'admin-local' | 'mcp-local';
  minimumRole: 'GLOBAL_ADMIN' | 'TENANT_ADMIN' | 'EDITOR';
  requiresConfirmation: boolean;
  
  // Execution
  handler: (ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  tenantId: string;
  userSub: string;
  userEmail: string;
  userRole: string;
  input: unknown;
  pageContext?: PageContextDTO; // For local tools
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresUserConfirmation?: boolean;
  proposedAction?: ProposedAction; // For write tools
}
```

---

## Access Control

**Decision: Tenant-level feature flag + role list.**

Schema addition to `TenantConfigSchema`:

```typescript
aiAssistant: z.object({
  enabled: z.boolean().default(false),
  allowedRoles: z.array(z.enum(['TENANT_ADMIN', 'EDITOR'])).default(['TENANT_ADMIN']),
  dailyTokenBudget: z.number().optional(), // null = unlimited
}).default({ enabled: false, allowedRoles: ['TENANT_ADMIN'] })
```

**Enforcement points:**

1. Backend `/ai/chat` handler checks `config.aiAssistant.enabled` and `allowedRoles.includes(userRole)`
2. **GLOBAL_ADMIN bypass:** `GLOBAL_ADMIN` role always passes the gate regardless of `allowedRoles`. Global admins are agency operators, not tenant editors; they need AI access for support/debugging without per-tenant config. Enforcement: `if (userRole === 'GLOBAL_ADMIN' || allowedRoles.includes(userRole))`
3. Admin UI hides AI drawer if not enabled for user's role (GLOBAL_ADMIN always sees it)
4. Tool ACL filter further restricts per-tool based on `minimumRole`

**Deferred:** Per-user allowlist requires DynamoDB user-capability records. Not needed for phase 1.

---

## Provider Gateway

```typescript
// backend/src/ai/llm-gateway.ts

interface LlmGateway {
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;
}

interface ChatRequest {
  messages: Message[];
  tools: ToolSchema[];
  model?: string;
  maxTokens?: number;
}

// Phase 1: OpenAI implementation only
class OpenAiGateway implements LlmGateway {
  private apiKey: string; // From SSM, cached in process memory
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Call OpenAI API
  }
}
```

**Key handling:**

- Stored in SSM Parameter Store (SecureString) — matches existing pattern for reCAPTCHA
- Fetched once per Lambda cold start
- Cached in process memory
- Never returned by any API endpoint
- Never inserted into conversation transcript
- Never exposed to model as tool output

---

## Page Context Adapters

Each major editor page registers a context adapter:

```typescript
// admin/src/lib/ai/context-adapters.ts

interface PageContextAdapter {
  getContext(): PageContextDTO;
  applyPatch(patch: DraftPatch): void;
}

// Content Editor
interface ContentEditorContext {
  type: 'content-editor';
  pageId: string;
  slug: string;
  title: string;
  status: string;
  blocks: Block[]; // Current unsaved state
  selection?: {
    blockIndex: number;
    startOffset: number;
    endOffset: number;
    selectedText: string;
  };
}

// Product Editor
interface ProductEditorContext {
  type: 'product-editor';
  productId: string;
  formState: Partial<Product>; // Current unsaved form values
}

// Strategy Editor
interface StrategyEditorContext {
  type: 'strategy-editor';
  documentId: string;
  title: string;
  blocks: Block[];
}

// List pages
interface ListPageContext {
  type: 'list-page';
  entityType: 'content' | 'products' | 'orders' | 'customers';
  filters: Record<string, string>;
  selectedIds: string[];
  visibleSummaries: EntitySummary[];
}
```

**Rule:** Do not scrape DOM. Do not infer state from rendered HTML. Pass a DTO.

---

## Write Safety Model

**Mandatory for all write-capable tools.**

### Option A: Local Apply-Preview (for draft tools)

1. Model proposes patch (e.g., new block content)
2. UI shows diff/preview in the AI drawer
3. User clicks "Apply" or "Reject"
4. If applied: patch merges into local unsaved state
5. User saves via existing save flow (which runs validation, slug checks, etc.)

### Option B: Confirmed Backend Mutation (for persisted tools)

1. Model proposes action (e.g., create page with title X)
2. UI shows proposed action with confirmation button
3. User clicks "Confirm" or "Cancel"
4. If confirmed: backend executes, emits audit event
5. UI refreshes relevant data

**Never:** Silent backend writes without user confirmation.

---

## Persistence & Audit

### Conversation Threads

**PROTOTYPE:** Ephemeral, client-side only. Thread state lives in React state / sessionStorage. Closes on tab close or explicit clear. No DynamoDB storage.

**MATURE:** TTL-backed DynamoDB storage for resumable threads:

```
PK: TENANT#<tenantId>
SK: AICHAT#<userSub>#<threadId>#META
TTL: 7 days from last message

PK: TENANT#<tenantId>
SK: AICHAT#<userSub>#<threadId>#MSG#<isoTimestamp>
TTL: 7 days from creation
```

- Tenant-scoped, user-scoped
- Query-only access (no scans)
- Thread list endpoint: `GET /ai/threads`
- Resume thread: include `threadId` in `POST /ai/chat`

**Decision:** Thread persistence is deferred to MATURE. Prototype ships with ephemeral threads only.

### Audit Events (Immutable)

Separate from thread storage. Uses existing `publishAudit` infrastructure.

```typescript
{
  type: 'AI_TOOL_EXECUTION',
  actor: { email: userEmail, sub: userSub },
  target: { 
    type: 'page' | 'product' | ...,
    id: entityId,
    title: entityTitle
  },
  tool: toolName,
  action: 'create' | 'update' | 'delete',
  // Do NOT store: raw prompts, full transcript, API keys
}
```

**Deferred:** Full transcript retention policy for compliance.

---

## UI Components

### AI Drawer

Mounted from `AdminLayout.tsx` (owns the cross-page shell).

```
┌─────────────────────────────────────────┐
│ AI Assistant                        [X] │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ User: Help me rewrite the hero  │   │
│  │ headline to be more engaging    │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Assistant: I'll analyze the     │   │
│  │ current headline...             │   │
│  │                                 │   │
│  │ ┌─────────────────────────────┐ │   │
│  │ │ Tool: rewrite_selected_text │ │   │
│  │ │ Status: ✓ Complete          │ │   │
│  │ └─────────────────────────────┘ │   │
│  │                                 │   │
│  │ Here's a revised version:       │   │
│  │ "Transform Your Business..."    │   │
│  │                                 │   │
│  │ ┌──────────┐ ┌────────────┐    │   │
│  │ │  Apply   │ │   Reject   │    │   │
│  │ └──────────┘ └────────────────┘ │   │
│  └─────────────────────────────────┘   │
│                                         │
├─────────────────────────────────────────┤
│ [Type a message...]            [Send]   │
└─────────────────────────────────────────┘
```

### Inline Assists (Phase 2)

Buttons on specific forms powered by same backend:

- "Improve with AI" on text fields
- "Generate SEO" on product/page editors
- "Translate" on block content

---

## File Structure

```
packages/shared/src/
├── index.ts                    # Add: AiChatRequestSchema, AiChatResponseSchema,
│                               #      ToolEnvelopeSchema, AiAssistantConfigSchema

backend/src/ai/
├── index.ts                    # Exports
├── llm-gateway.ts              # LlmGateway interface + OpenAI implementation
├── tool-registry.ts            # Central tool definitions (admin-chat only in prototype)
├── tool-executor.ts            # Backend tool execution
├── acl-filter.ts               # Filter tools by user role + surface
├── orchestrator.ts             # Chat loop: model → tools → model
├── conversation-store.ts       # [MATURE] TTL thread storage — not in prototype
└── handlers/
    ├── chat.ts                 # POST /ai/chat
    └── threads.ts              # [MATURE] GET /ai/threads — not in prototype

admin/src/components/ai/
├── AiDrawer.tsx                # Main drawer component
├── MessageList.tsx             # Conversation display
├── ToolActivity.tsx            # Tool execution status
├── ConfirmationCard.tsx        # Write confirmation UI
└── DraftPreview.tsx            # Diff view for draft patches

admin/src/lib/ai/
├── context-adapters.ts         # Page context DTO providers
├── local-executor.ts           # Local draft tool execution
├── use-ai-chat.ts              # React hook for chat state
└── use-page-context.ts         # Hook to get current page context

tools/mcp-server/src/
├── index.ts                    # [MATURE] Refactored to thin adapter over backend registry
│                               # PROTOTYPE: unchanged, continues to drift from backend
│                               # Only local-machine tools (Playwright) remain MCP-owned post-refactor
```

---

## Maturity Phases

### SUPPORT Module

| Phase | Scope |
|-------|-------|
| **PROTOTYPE** | OpenAI-backed `LlmGateway`. Central tool registry (read-only backend tools + content editor draft tools). Tool ACL filtering. **Hybrid orchestration contract** (backend returns `admin-local` tool calls to browser, browser returns results, loop continues). Non-streaming responses. Ephemeral threads (client-side only). |
| **MATURE** | Context adapters for all major editors. TTL-backed thread persistence (DynamoDB). Budget counters. Audit summaries. MCP adapter consuming same registry. Streaming responses. |
| **PRODUCTION** | Per-tenant AI policy enforcement. Per-surface tool policy. Observability. Prompt injection hardening. Redaction layer. Failure-mode tests. Budget enforcement. |

### FEATURE Module

| Phase | Scope |
|-------|-------|
| **PROTOTYPE** | AI drawer in admin shell. Content editor integration (context adapter + local patch executor). Read current page via backend tool. Propose edits via local draft tools. Block patch DTO with explicit operations. Confirmation UI for patches. |
| **MATURE** | Product editor. Strategy editor. Assets/forms/signals lookup. Thread history (resumable from DynamoDB). Inline assist buttons. |
| **PRODUCTION** | Full tool surface. Per-role gating finalized. Audit-grade write flows. Budget controls per tenant. |

**Note:** Hybrid orchestration is a PROTOTYPE requirement, not a MATURE enhancement. The entire draft-safety model depends on the backend returning `admin-local` tool calls to the browser. Without hybrid orchestration, local draft tools cannot function.

---

## Open Decisions

| Question | Options | Decision |
|----------|---------|----------|
| Streaming in prototype? | Yes (Lambda Function URL) / No (simple response) | **No.** Non-streaming acceptable for prototype. Streaming deferred to MATURE. |
| Thread persistence in prototype? | Yes / No (ephemeral only) | **No.** Ephemeral threads only. TTL-backed persistence deferred to MATURE. |
| MCP refactor timing? | Before admin AI / After / Never | **After.** Admin AI ships first with its own registry; MCP refactored to consume shared registry in MATURE phase. Drift is acceptable short-term. |
| Provider abstraction depth? | Interface only / Full multi-provider | **Interface only.** `LlmGateway` interface from day one; only OpenAI implementation in prototype. Second provider unlikely near-term. |

---

## Technical Debt to Record

| Item | Priority | Notes |
|------|----------|-------|
| Playwright/social parity remains MCP-only | Low | Requires Fargate or similar for headful browser |
| Per-user AI allowlist | Medium | Postponed in favor of tenant-role policy |
| Full transcript retention policy | Medium | Compliance-dependent |
| MCP registry refactor | High | Staged after admin AI prototype ships |
| Prompt injection hardening | High | Required before production — scraped content and user input flow into prompts |

---

## Dependencies

- SSM Parameter Store entry for OpenAI API key (agency-wide)
- CDK route registration for `/ai/chat`
- Admin role check utility (may already exist)
- Existing `publishAudit` infrastructure for write events

---

## Related Plans

- `docs/plan-commerce-private-table.md` — Make commerce tables private (in progress)
- Events scheduling module — planned, no plan doc yet

---

## References

- Current MCP server: `tools/mcp-server/MAP.md`
- Existing auth: `docs/authentication-architecture.md`
- Tenant config patterns: `packages/shared/src/index.ts`
