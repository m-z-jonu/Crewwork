# Automated Hosting Subscription Provisioning for CrewWork

> Generated 2026-07-12 · depth: standard · 46 sources · workspace: research/hosting-provisioning/

## Executive summary

- **Hostinger cannot be used for automated account provisioning.** Their public API (v0.12.0 beta) covers VPS, Domains, DNS, and Billing only — there is no reseller API, no sub-account creation, no shared hosting management, and no multi-tenant model [1-9].
- **WHMCS is the industry standard** for hosting billing + provisioning (35k+ customers), with built-in cPanel/Plesk provisioning modules, but it's closed-source (IonCube-encoded) and expensive ($34.95–$1,999.95/mo) [10-13].
- **Blesta is the better open-source alternative** — 99%+ open code, flat $17.95/mo with unlimited clients, native multi-company support, and bidirectional webhooks for external integration [14-17].
- **Virtualmin (GPL) is the strongest free hosting control panel** with a comprehensive API covering 100+ operations including create-domain, delete-domain, create-user, and create-reseller — fully open-source [22-26].
- **HestiaCP has a solid REST API** with granular access keys and non-admin API users since v1.6.0, suitable for third-party billing integration [27-31].
- **Stripe Entitlements is the purpose-built pattern** for subscription-driven provisioning — compare `entitlements.data` before/after to detect revocations [38-40].
- **No existing open-source tool combines Stripe + hosting provisioning** — the integration must be custom-built using Stripe webhooks + control panel APIs [43-47].

## Background & scope

CrewWork sells hosting subscriptions to end users. The system must: (1) provision a hosting account on payment, (2) grant user access, (3) revoke access if payment stops. The investigation covered Hostinger's API, WHMCS/Blesta billing platforms, open-source control panels, Stripe integration patterns, and existing GitHub/npm tools.

**Key constraint discovered:** Hostinger's public API has no reseller or shared hosting provisioning capability. This fundamentally changes the approach.

## The Hostinger problem

Hostinger's API is single-account scoped with no multi-tenant model [5][6]. The four API domains (VPS, Domains, DNS, Billing) can manage VPS instances programmatically [3][4], but there is no endpoint for creating hosting accounts for other users. No partner/reseller API tier is documented publicly [9].

**Implications for CrewWork:**
- Cannot auto-provision Hostinger shared hosting via API
- VPS provisioning IS possible (POST /api/vps/v1/virtual-machines) but VPS management is complex for end users
- Would need to contact Hostinger enterprise sales for any private/partner API access
- Alternative: use a hosting provider with a proper reseller/cPanel API

## Recommended architecture

Given the constraints, CrewWork has three viable paths:

### Option A: WHMCS + cPanel reseller (fastest to market)

| Component | Role |
|-----------|------|
| WHMCS ($34.95+/mo) | Billing, provisioning orchestration, client management |
| cPanel/WHM reseller plan | Actual hosting accounts |
| Stripe (via WHMCS module) | Payment processing |
| WHMCS cPanel module | Auto-provisions cPanel accounts on order |

**Flow:** User pays → Stripe webhook → WHMCS processes order → WHMCS cPanel module creates account → credentials delivered to user. Payment stops → WHMCS suspends/terminates → cPanel account suspended.

- Pros: Battle-tested, 35k+ users, large module ecosystem, cloud-hosted option [11][18]
- Cons: Closed-source, expensive at scale, IonCube prevents auditing [13][15]

### Option B: Blesta + Virtualmin/HestiaCP (open-source stack)

| Component | Role |
|-----------|------|
| Blesta ($17.95/mo) | Billing, client management, webhook orchestration |
| Virtualmin GPL or HestiaCP | Hosting control panel with provisioning API |
| Stripe (built-in) | Payment processing |
| Custom Blesta module or webhook | Bridges Stripe events → control panel API |

**Flow:** User pays → Stripe → Blesta inbound webhook → Blesta provisioning module calls Virtualmin/HestiaCP API → account created. Payment stops → Blesta webhook terminates account.

- Pros: Open-source, 99% auditable code, flat pricing, multi-company native [14-17]
- Cons: Smaller ecosystem, more custom development needed

### Option C: Custom (Stripe + Virtualmin directly)

| Component | Role |
|-----------|------|
| Custom Node.js/Python service | Webhook handler + provisioning logic |
| Stripe Entitlements | Subscription lifecycle management |
| Virtualmin GPL or HestiaCP | Hosting panel with API |
| PostgreSQL/Redis | State tracking, idempotency |

**Flow:** User pays → Stripe Entitlements webhook → Custom service calls Virtualmin API → account created. Payment stops → Stripe revokes entitlement → custom service deletes/suspends account.

- Pros: Full control, no licensing fees, can work with any control panel
- Cons: Must build client portal, provisioning queue, error handling, monitoring from scratch

## Comparison table

| Factor | WHMCS | Blesta | Custom + Virtualmin |
|--------|-------|--------|---------------------|
| License cost | $34.95–$1,999.95/mo | $17.95/mo (flat) | $0 |
| Source code | Closed (IonCube) | 99% open | Fully open |
| cPanel provisioning | Built-in module | Built-in module | Via API (manual) |
| API quality | RESTful + OAuth | RESTful + webhooks | HTTP CGI + JSON |
| Multi-company | Third-party module | Native | N/A |
| Client portal | Built-in | Built-in | Must build |
| Ecosystem | Large (35k+ users) | Medium (26+ built-in) | Small |
| Setup complexity | Low | Medium | High |
| Best for | Quick launch, don't mind cost | Cost-sensitive, open-source preference | Full control, technical team |

## Open-source control panel ranking

| Panel | API | Provisioning | License | Notes |
|-------|-----|-------------|---------|-------|
| Virtualmin GPL | 100+ programs, HTTP CGI | create-domain, delete-domain, create-user, create-reseller | GPL (free) | Most comprehensive API [22-26] |
| HestiaCP | REST API + CLI | create-user, add-web-domain, add-database | GPL (free) | 4.4k stars, granular API keys [27-31] |
| CyberPanel | API directory (poor docs) | Unknown (docs 404) | LGPL (free) | High stars but documentation gaps [33-35] |
| SolidCP | No public REST API | Unknown | MPL (free) | Windows/.NET, not suitable [36-37] |

## Key GitHub/npm tools

| Tool | Type | Stars | Status | Relevance |
|------|------|-------|--------|-----------|
| n8n-nodes-whmcs | n8n workflow node | - | Active (Jun 2026) | WHMCS workflow automation [39] |
| @oxheberg/whmcs-api | TS WHMCS client | - | Active (2025) | Type-safe WHMCS API access [40] |
| Fruitware/whmcs-wrapper | PHP WHMCS wrapper | - | Active (Jun 2026) | Only maintained PHP wrapper [41] |
| Shockbyte/whmcs-node | JS WHMCS client | 13 | Stable (2023) | Most popular JS wrapper [38] |
| Kastell | Server provisioning CLI | 56 | Active (Jun 2026) | VPS provisioning, not hosting panels [42] |
| detain/cpanel-licensing | CPanel license API | 8 | Stable (2019) | CPanel license automation [43] |

## Cost considerations

| Approach | Monthly cost (100 users) | Monthly cost (1,000 users) |
|----------|-------------------------|---------------------------|
| WHMCS + cPanel reseller | ~$85 + cPanel licenses | ~$199 + cPanel licenses |
| Blesta + Virtualmin | ~$18 + VPS costs | ~$18 + VPS costs |
| Custom + Virtualmin | VPS only | VPS only |

**Note:** cPanel licenses cost ~$15/mo per server (or included in reseller plans). WHMCS pricing scales with client count; Blesta does not.

## Recommendations

1. **If Hostinger is required:** Contact Hostinger enterprise/devs@hostinger.com about partner API access. Their public API cannot support this use case.

2. **If open-source is preferred:** Use Blesta + Virtualmin GPL or HestiaCP. Blesta's flat pricing and native webhooks make it ideal for the Stripe integration. Virtualmin's API is the most mature for automated provisioning.

3. **If speed to market matters:** WHMCS with a cPanel reseller plan. It's the proven path — 35k+ hosting businesses use it.

4. **Stripe integration pattern:** Use Stripe Entitlements (not raw subscription webhooks) for clean provision/revocation semantics. The `entitlements.active_entitlement_summary.updated` webhook fires on all lifecycle events [38-40].

5. **Architecture:** Whatever panel you choose, the webhook handler should be async (queue provisioning work), idempotent (log processed event IDs), and verify Stripe signatures [44-47].

## Open questions

1. Does Hostinger offer a private/partner reseller API not documented publicly? Worth contacting their enterprise sales.
2. Can Hostinger shared hosting be provisioned via WHM/cPanel backend if the user has a reseller hosting plan (bypassing Hostinger's API entirely)?
3. What is the actual cPanel license cost structure for high-volume resellers?
4. Does Blesta's inbound webhook support trigger provisioning synchronously, or is a queue layer needed?
5. How do Virtualmin's GPL vs Professional API capabilities differ for automated provisioning?

## Sources

[1] Hostinger API GitHub — https://github.com/hostinger/api (accessed 2026-07-12)
[2] Hostinger API Getting Started — https://deepwiki.com/hostinger/api/2-getting-started (accessed 2026-07-12)
[3] Hostinger VPS Lifecycle API — https://deepwiki.com/hostinger/api/4.1-virtual-machine-lifecycle (accessed 2026-07-12)
[4] Hostinger n8n Node — https://github.com/hostinger/api-n8n-node (accessed 2026-07-12)
[5] Hostinger API Token Management — https://deepwiki.com/hostinger/api/2-getting-started (accessed 2026-07-12)
[6] Hostinger Developers Portal — https://developers.hostinger.com (accessed 2026-07-12)
[7] Hostinger SDKs & Tools — https://github.com/hostinger/api (accessed 2026-07-12)
[8] Hostinger Billing API — https://deepwiki.com/hostinger/api/3-billing-api (accessed 2026-07-12)
[9] Hostinger API Setup — https://github.com/hostinger/api (accessed 2026-07-12)
[10] WHMCS Homepage — https://www.whmcs.com/ (accessed 2026-07-12)
[11] WHMCS Pricing — https://www.whmcs.com/pricing/ (accessed 2026-07-12)
[12] WHMCS API Documentation — https://developers.whmcs.com/api/ (accessed 2026-07-12)
[13] WHMCS Hooks — https://developers.whmcs.com/hooks/ (accessed 2026-07-12)
[14] Blesta Homepage — https://www.blesta.com/ (accessed 2026-07-12)
[15] Blesta vs WHMCS Comparison — https://www.blesta.com/compare/blesta-vs-whmcs/ (accessed 2026-07-12)
[16] Blesta Pricing — https://www.blesta.com/pricing/ (accessed 2026-07-12)
[17] Blesta Integrations — https://www.blesta.com/integrations/ (accessed 2026-07-12)
[18] WHMCS Cloud — https://www.whmcs.com/pricing/ (accessed 2026-07-12)
[19] WHMCS Integrations — https://www.whmcs.com/ (accessed 2026-07-12)
[20] WHMCS API Reference — https://developers.whmcs.com/api/ (accessed 2026-07-12)
[21] WHMCS Hook Types — https://developers.whmcs.com/hooks/ (accessed 2026-07-12)
[22] Virtualmin Remote API — https://www.virtualmin.com/docs/development/remote-api/ (accessed 2026-07-12)
[23] Virtualmin Documentation — https://www.virtualmin.com/docs/ (accessed 2026-07-12)
[24] Virtualmin API Programs — https://www.virtualmin.com/docs/ (accessed 2026-07-12)
[25] Virtualmin Remote API CGI — https://www.virtualmin.com/docs/development/remote-api/ (accessed 2026-07-12)
[26] Virtualmin GPL vs Professional — https://www.virtualmin.com/docs/ (accessed 2026-07-12)
[27] HestiaCP REST API — https://github.com/hestiacp/hestiacp/blob/main/docs/docs/server-administration/rest-api.md (accessed 2026-07-12)
[28] HestiaCP Access Keys — https://github.com/hestiacp/hestiacp/blob/main/docs/docs/server-administration/rest-api.md (accessed 2026-07-12)
[29] HestiaCP Non-Admin API — https://github.com/hestiacp/hestiacp/blob/main/docs/docs/server-administration/rest-api.md (accessed 2026-07-12)
[30] HestiaCP Requirements — https://docs.hestiacp.com/docs/introduction/getting-started.html (accessed 2026-07-12)
[31] HestiaCP GitHub — https://github.com/hestiacp/hestiacp (accessed 2026-07-12)
[32] HestiaCP Getting Started — https://docs.hestiacp.com/docs/introduction/getting-started.html (accessed 2026-07-12)
[33] CyberPanel GitHub — https://github.com/usmannasir/CyberPanel (accessed 2026-07-12)
[34] CyberPanel Guides — https://github.com/usmannasir/CyberPanel/blob/stable/guides/INDEX.md (accessed 2026-07-12)
[35] CyberPanel Docs — https://github.com/usmannasir/CyberPanel (accessed 2026-07-12)
[36] SolidCP Homepage — https://solidcp.com/ (accessed 2026-07-12)
[37] SolidCP GitHub — https://github.com/ solidcp/solidcp (accessed 2026-07-12)
[38] Shockbyte/whmcs-node — https://github.com/Shockbyte/whmcs-node (accessed 2026-07-12)
[39] n8n-nodes-whmcs — https://www.npmjs.com/package/n8n-nodes-whmcs (accessed 2026-07-12)
[40] @oxheberg/whmcs-api — https://www.npmjs.com/package/@oxheberg/whmcs-api (accessed 2026-07-12)
[41] Fruitware/whmcs-wrapper — https://github.com/Fruitware/whmcs-wrapper (accessed 2026-07-12)
[42] Kastell — https://github.com/kastelldev/kastell (accessed 2026-07-12)
[43] detain/cpanel-licensing — https://github.com/detain/cpanel-licensing (accessed 2026-07-12)
[44] Stripe Entitlements — https://docs.stripe.com/billing/entitlements.md (accessed 2026-07-12)
[45] Stripe Subscription Webhooks — https://docs.stripe.com/billing/subscriptions/webhooks (accessed 2026-07-12)
[46] Stripe Webhooks — https://docs.stripe.com/webhooks (accessed 2026-07-12)
[47] Stripe Entitlements Webhooks — https://docs.stripe.com/billing/entitlements.md (accessed 2026-07-12)
