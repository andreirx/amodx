# AMODX

Serverless multi-tenant CMS and commerce platform on AWS. One deployment serves up to 99 tenant websites with full data isolation.

**Stack**: Next.js 16 + React 19 + Vite 7 + Tailwind v4 + Tiptap 3 + DynamoDB + Lambda (Node.js 22) + OpenNext 3 + CDK

**Live**: [amodx.net](https://amodx.net), [blog.bijup.com](https://blog.bijup.com)

## What It Does

- **Multi-tenant CMS** — block-based editor (19 custom plugins), content versioning, SEO engine (robots.txt, sitemap.xml, llms.txt)
- **Commerce** — products, categories, cart, checkout, orders, coupons, reviews, delivery scheduling, email templates
- **Engagement** — dynamic forms, marketing popups, lead capture, contact forms
- **MCP integration** — Claude Desktop controls tenants, content, and context via Model Context Protocol
- **i18n** — country packs with 3-tier merge (English defaults → pack language → admin overrides)

## Monorepo

npm workspaces. Build order: `shared → plugins → backend/admin/renderer`.

```
packages/shared/     Zod schemas, types, country packs
packages/plugins/    19 block plugins (split admin/render entry)
backend/             100+ Lambda handlers, 30 modules
admin/               React 19 SPA, 39 pages, shadcn/ui
renderer/            Next.js 16, OpenNext, multi-tenant SSR
infra/               CDK stacks (main + 2 nested)
tools/mcp-server/    Claude Desktop MCP server + Playwright
scripts/             Setup, domain management, post-deploy sync
```

## Quick Start

```bash
npm install
npm run build
cd admin && npm run dev        # localhost:5173
cd renderer && npm run dev     # localhost:3000
cd backend && npm test         # Vitest against staging DynamoDB
```

### Deploy

```bash
cd infra && npm run cdk deploy
npm run post-deploy            # sync .env files from CloudFormation outputs
```

### Add a Tenant Domain

1. Add domain to `amodx.config.json` → `tenants` array
2. `npm run manage-domains` — request ACM cert, add DNS CNAMEs
3. `npx cdk deploy` — update CloudFront
4. `npm run post-deploy` — sync local env

### Connect Claude Desktop

```bash
cd tools/mcp-server && npm run build && npm run setup
```

Requires master API key from Secrets Manager.

## Architecture

See [SDS.md](SDS.md) for the full system design specification — database schema, all Lambda modules, plugin reference, CDK stack structure, commerce workflow, and authentication flow.

## License

Apache 2.0
