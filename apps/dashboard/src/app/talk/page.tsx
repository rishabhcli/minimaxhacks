import { VapiWidget } from "@/components/VapiWidget";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

export default function TalkPage() {
  return (
    <ConvexClientProvider>
      <div className="page-stack">
        <section className="hero">
          <h2>Talk to ShieldDesk Support</h2>
          <p>
            Launch a direct voice session with the customer support agent. Conversation actions are
            governed by policy and routed through the trust layer before execution.
          </p>
        </section>
        <VapiWidget />
      </div>
    </ConvexClientProvider>
  );
}
