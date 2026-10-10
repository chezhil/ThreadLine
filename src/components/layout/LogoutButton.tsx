"use client";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "./sign-out";

export function LogoutButton({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => void signOut(router)}
      className={
        className ??
        "w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
      }
    >
      {children ?? "Sign out"}
    </button>
  );
}
