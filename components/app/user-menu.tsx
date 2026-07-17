"use client";

import { signOutAction } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";

function initials(name: string, email: string): string {
  const base = name.trim() || email;
  return base
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function UserMenu({
  fullName,
  email,
  roleLabel,
}: {
  fullName: string;
  email: string;
  roleLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus-visible:ring-ring flex items-center gap-2 rounded-full outline-none focus-visible:ring-2">
        <Avatar className="size-8">
          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
            {initials(fullName, email)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium">{fullName || email}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{roleLabel}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          {/*
            Radix runs its select handler inside this click and, unless the select event is
            default-prevented, synchronously closes the menu — unmounting this form. A form
            detached from the document cannot submit, so the action never ran. Preventing the
            select keeps the form mounted so the button's submit fires; the redirect to /login
            tears the menu down anyway.
          */}
          <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
            <button type="submit" className="flex w-full cursor-pointer items-center gap-2">
              <LogOut className="size-4" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
