import { EmptyState } from "@/components/ui";

// Temporary placeholder for routes owned by another module's agent/branch.
// Delete this file's usage once that module's real page is merged — don't
// build the real feature here, it's outside this module's scope.
export function ModulePlaceholder({ owner, feature }: { owner: string; feature: string }) {
  return (
    <EmptyState
      title={`${feature} — coming soon`}
      description={`Owned by ${owner}. This page will be replaced once that module merges.`}
    />
  );
}
