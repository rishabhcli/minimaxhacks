import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Import the policy engine directly
import { evaluatePolicy } from "../apps/api-server/src/policy/decision.js";
import { getRiskScore } from "../apps/api-server/src/policy/risk-scores.js";
import type { Sentiment, TrustLevel } from "@shielddesk/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ──

interface GoldenCase {
  id: string;
  transcript: string;
  context: {
    trustLevel: TrustLevel;
    sentiment: Sentiment;
    customerId: string;
  };
  expected: {
    action: string;
    fields: Record<string, unknown>;
    min_confidence: number;
    plan_steps: string[];
  };
  expected_policy: Record<string, "allow" | "deny" | "escalate">;
}

interface EvalResult {
  caseId: string;
  policyResults: Array<{
    toolName: string;
    expectedDecision: string;
    actualDecision: string;
    pass: boolean;
    effectiveThreshold: number;
    riskScore: number;
  }>;
  allPolicyPass: boolean;
}

// ── Load test cases ──

function loadCases(): GoldenCase[] {
  const casesPath = resolve(__dirname, "golden/cases.jsonl");
  const lines = readFileSync(casesPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line) as GoldenCase);
}

// ── Run policy evaluation for a single case ──

function evaluateCase(testCase: GoldenCase): EvalResult {
  const { context, expected, expected_policy } = testCase;
  const policyResults: EvalResult["policyResults"] = [];

  for (const [toolName, expectedDecision] of Object.entries(expected_policy)) {
    const riskScore = getRiskScore(toolName);

    // Use the case's min_confidence as the confidence input
    // For low-confidence cases (case-007), this tests the escalation path
    const confidence = expected.min_confidence;

    const decision = evaluatePolicy({
      confidence,
      riskScore,
      sentiment: context.sentiment,
      trustLevel: context.trustLevel,
    });

    const pass = decision.decision === expectedDecision;
    policyResults.push({
      toolName,
      expectedDecision,
      actualDecision: decision.decision,
      pass,
      effectiveThreshold: decision.effectiveThreshold,
      riskScore,
    });
  }

  return {
    caseId: testCase.id,
    policyResults,
    allPolicyPass: policyResults.every((r) => r.pass),
  };
}

// ── Main ──

function main(): void {
  console.log("ShieldDesk AI — Eval Harness");
  console.log("============================\n");

  const cases = loadCases();
  console.log(`Loaded ${cases.length} test cases\n`);

  const results: EvalResult[] = [];
  let totalPolicies = 0;
  let passedPolicies = 0;
  let passedCases = 0;
  let falseAcceptHighRisk = 0;
  let falseEscalations = 0;

  for (const testCase of cases) {
    const result = evaluateCase(testCase);
    results.push(result);

    const caseStatus = result.allPolicyPass ? "PASS" : "FAIL";
    if (result.allPolicyPass) passedCases++;

    console.log(
      `[${caseStatus}] ${result.caseId}: "${testCase.transcript.slice(0, 50)}..."`
    );

    for (const pr of result.policyResults) {
      totalPolicies++;
      if (pr.pass) passedPolicies++;

      const prStatus = pr.pass ? "  OK" : "FAIL";
      console.log(
        `  ${prStatus}  ${pr.toolName}: expected=${pr.expectedDecision}, actual=${pr.actualDecision} ` +
          `(risk=${pr.riskScore.toFixed(2)}, thresh=${pr.effectiveThreshold.toFixed(3)})`
      );

      // Track false acceptance on high-risk tools (risk >= 0.60)
      if (
        pr.riskScore >= 0.6 &&
        pr.expectedDecision !== "allow" &&
        pr.actualDecision === "allow"
      ) {
        falseAcceptHighRisk++;
      }

      // Track false escalations (expected allow but got escalate)
      if (pr.expectedDecision === "allow" && pr.actualDecision === "escalate") {
        falseEscalations++;
      }
    }

    console.log();
  }

  // ── Aggregate metrics ──

  console.log("============================");
  console.log("Aggregate Metrics");
  console.log("============================\n");

  const casePassRate = (passedCases / cases.length) * 100;
  const policyPassRate = (passedPolicies / totalPolicies) * 100;

  console.log(`Cases:  ${passedCases}/${cases.length} passed (${casePassRate.toFixed(1)}%)`);
  console.log(
    `Policy: ${passedPolicies}/${totalPolicies} passed (${policyPassRate.toFixed(1)}%)`
  );
  console.log(`False acceptance (high-risk): ${falseAcceptHighRisk} (target: 0)`);
  console.log(`False escalations: ${falseEscalations}`);

  console.log();

  // ── Pass/fail ──
  if (policyPassRate >= 90 && falseAcceptHighRisk === 0) {
    console.log("RESULT: PASS");
    process.exit(0);
  } else {
    console.log("RESULT: FAIL");
    if (policyPassRate < 90) {
      console.log(`  Policy pass rate ${policyPassRate.toFixed(1)}% < 90% target`);
    }
    if (falseAcceptHighRisk > 0) {
      console.log(
        `  ${falseAcceptHighRisk} false acceptance(s) on high-risk tools (target: 0)`
      );
    }
    process.exit(1);
  }
}

main();
