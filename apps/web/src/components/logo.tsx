import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-primary", className)}>
      <ShieldCheck className="size-5" aria-hidden />
      Cumplia
    </span>
  );
}
