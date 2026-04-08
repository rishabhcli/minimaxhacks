import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toMcpToolName } from "../src/vapi/tool-definitions.js";

describe("toMcpToolName", () => {
  it("converts every underscore segment to dot notation", () => {
    assert.equal(toMcpToolName("faq_search"), "faq.search");
    assert.equal(toMcpToolName("ticket_escalate"), "ticket.escalate");
    assert.equal(
      toMcpToolName("customer_account_lookup"),
      "customer.account.lookup"
    );
  });
});
