import { Badge, LIFECYCLE_TONE, MEMBERSHIP_TONE } from "@/components/ui/badge";
import { LIFECYCLE, MEMBERSHIP_STATUS, label } from "@/lib/format";

export function LifecycleBadge({ lifecycle }: { lifecycle: string | null }) {
  return (
    <Badge tone={LIFECYCLE_TONE[lifecycle ?? "no_enquiry"] ?? "neutral"} dot>
      {label(LIFECYCLE, lifecycle ?? "no_enquiry")}
    </Badge>
  );
}

export function MembershipBadge({ status }: { status: string }) {
  return (
    <Badge tone={MEMBERSHIP_TONE[status] ?? "neutral"} dot>
      {label(MEMBERSHIP_STATUS, status)}
    </Badge>
  );
}
