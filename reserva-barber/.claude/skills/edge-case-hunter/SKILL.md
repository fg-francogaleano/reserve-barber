---
name: edge-case-hunter
description: Analyze user stories or tickets to uncover edge cases, infrastructure failures, and complex UI/UX states before specification.[cite: 2]
author: Nivus360
version: 1.0.0
---
# edge-case-hunter Skill[cite: 2]

Use it when this workflow is required in the project to prevent incomplete specifications.

## Instructions[cite: 2]

Please analyze the following user story or ticket: $ARGUMENTS.

Act as a QA Lead, Security Architect (Red Teamer), and UI/UX Expert. Your sole objective is to mentally "break" the provided story to find all scenarios where the system might fail, behave unexpectedly, or degrade the user experience.

Follow these steps:

1. **UI/UX State Analysis:** Do not assume the Happy Path. Identify transient states (loading skeletons, disabled buttons, sober/minimalist visual feedback for errors, and empty states). Consider hydration or SSR edge cases if using frameworks like Next.js.
2. **Infrastructure Failures:** Determine what happens if the database times out, or if a third-party API (e.g., payment gateway, email provider) responds with a 503 or takes 10 seconds.
3. **Alternative Flows (Bad Paths):** Identify scenarios involving duplicate data submission, abandoned flows, or concurrency issues (two users editing the same entity).
4. **Vulnerabilities:** Assess if the endpoint can be abused. Check for missing rate-limiting, injection risks, or sensitive data exposure.

Output format must strictly be:
- `### 1. 🛑 Critical Vulnerabilities & Failures`
- `### 2. 🔀 Alternative Flows (Bad Paths)`
- `### 3. 🎨 Required UI/UX States`
- `### 4. 📋 Extended Acceptance Criteria (BDD Gherkin)`: Write at least 3 scenarios covering the most important edge cases (Given/When/Then). DO NOT write the Happy Path here.

## Notes[cite: 2]

- Do not propose code in this stage. The goal is pure context generation so the OpenSpec `/new` or `/ff` command can build a bulletproof specification.
- Keep all responses in English to comply with the project standards[cite: 1].