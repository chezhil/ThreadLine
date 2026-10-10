import { OwnerOnly } from "@/components/accounts/OwnerOnly";
import { AssistantClient } from "@/components/assistant/AssistantClient";

export const instant = false;

export default function Page() {
  return (
    <OwnerOnly>
      <AssistantClient />
    </OwnerOnly>
  );
}
