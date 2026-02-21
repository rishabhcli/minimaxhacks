"use client";

import { useParams } from "next/navigation";
import { ConversationDetail } from "@/components/ConversationDetail";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

export default function ConversationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <ConvexClientProvider>
      <ConversationDetail conversationId={id} showBackLink />
    </ConvexClientProvider>
  );
}
