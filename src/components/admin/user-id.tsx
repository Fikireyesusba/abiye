import Link from "next/link";
import { cn } from "@/lib/utils";

/** A person in any admin list: only their User ID, linking to their details. */
export function UserIdLink({ id, label = "User ID", className }: { id: string | null | undefined; label?: string; className?: string }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/admin/users/${id}`} className={cn("font-mono font-medium text-primary hover:underline", className)} data-testid="user-id">
      {label ? `${label} ` : ""}{id}
    </Link>
  );
}
