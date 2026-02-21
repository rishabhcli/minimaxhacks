---
active: true
iteration: 1
max_iterations: 15
completion_promise: "POLICY COMPLETE"
started_at: "2026-02-21T19:00:32Z"
---

Build the policy engine in apps/api-server/src/policy/. Implement decision.ts with f(confidence, risk, sentiment, trust_level) and risk-scores.ts. Follow the exact formulas in CLAUDE.md: sentiment modifiers (frustrated=1.4x, neutral=1.0x, satisfied=0.9x, calm=0.8x), trust ceilings (Anonymous=0.10, Authenticated=0.40, Premium=0.65, VIP=0.85). Output <promise>POLICY COMPLETE</promise> when unit tests pass.
