# Research Brief: Automated Hosting Subscription Provisioning

**Date**: 2026-07-12
**Depth**: standard
**Audience**: Technical decision-maker building a hosting reseller/SaaS product

## Question

What open-source tools and APIs enable automated provisioning of hosting accounts (Hostinger, cPanel, Plesk) tied to Stripe payment subscriptions, where access is granted on payment and revoked on non-payment?

## Scope

**In scope:**
- Hostinger API for account provisioning (does it exist? what can it do?)
- WHMCS, Blesta, and other hosting billing/provisioning platforms
- SolidCP and open-source hosting control panels with APIs
- Stripe webhook → hosting provisioning integration patterns
- Reseller hosting automation tools
- GitHub repos for hosting provisioning automation
- Cost comparisons across approaches

**Out of scope:**
- Building a custom hosting control panel from scratch
- Non-hosting SaaS provisioning (e.g., AWS, GCP)
- Detailed Hostinger reseller pricing (just provisioning capabilities)

## Assumptions

- CrewWork is a platform that sells hosting subscriptions
- Users pay CrewWork, CrewWork provisions hosting on their behalf
- Need automated provisioning + deprovisioning based on payment status
- Budget-conscious: prefer open-source or low-cost solutions
- Hostinger is the preferred hosting provider (but alternatives welcome)

## Angles

1. Hostinger API capabilities for reseller/account provisioning
2. WHMCS and Blesta - hosting billing + provisioning platforms
3. Open-source hosting control panels with API (SolidCP, Virtualmin, etc.)
4. Stripe + hosting provisioning integration patterns and tools
5. GitHub repos and npm packages for hosting automation
