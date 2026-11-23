import Link from "next/link";
import { cn } from "@/lib/utils";

/** A person in any admin list: only their User ID number, linking to their details (name, contact… open on click). */
export function UserIdLink({ id, className }: { id: string | null | undefined; className?: string }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/admin/users/${id}`} className={cn("font-mono font-medium text-primary hover:underline", className)} data-testid="user-id" title="Open this person's details" aria-label={`User ID ${id}`}>
      {id}
    </Link>
  );
}
