"use client";

import Link from "next/link";
import { 
  Home, 
  Podcast,
  Mail,
  User,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { memo, useMemo, useCallback } from "react";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

interface MobileDockProps {
  className?: string;
}

// Memoized NavItem component to prevent unnecessary re-renders
const NavItem = memo(({ item, isActive }: { item: NavItem; isActive: boolean }) => (
  <Link 
    href={item.href} 
    className={cn(
      "flex flex-col items-center justify-center p-2 relative",
      "transition-colors duration-200 ease-in-out h-12 w-12",
      isActive 
        ? "text-primary" 
        : "text-muted-foreground hover:text-foreground"
    )}
    aria-current={isActive ? "page" : undefined}
  >
    <item.icon 
      size={22} 
      strokeWidth={2}
    />
    <span className="sr-only">{item.label}</span>
  </Link>
));

NavItem.displayName = "NavItem";

// The main component is also memoized to prevent unnecessary re-renders
export const MobileDock = memo(function MobileDock({ className }: MobileDockProps) {
  const pathname = usePathname();
  
  // Memoize the navItems array to prevent recreation on each render
  const navItems = useMemo<NavItem[]>(() => [
    { href: "/", icon: Home, label: "Home" },
    { href: "/newsletters", icon: Mail, label: "Newsletters" },
    { href: "/podcasts", icon: Podcast, label: "Podcasts" },
    { href: "/chat", icon: Sparkles, label: "Ask AI" },
    { href: "/profile", icon: User, label: "Profile" },
  ], []);

  // Memoize the isActive check function
  const checkIsActive = useCallback((href: string) => {
    return pathname === href || (href !== "/" && pathname.startsWith(href));
  }, [pathname]);

  return (
    <nav 
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 md:hidden",
        "bg-background/85 backdrop-blur-md border-t border-border",
        "py-2 px-4 pb-safe-bottom shadow-sm",
        className
      )}
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-around">
        {navItems.map((item) => (
          <NavItem 
            key={item.href} 
            item={item} 
            isActive={checkIsActive(item.href)} 
          />
        ))}
      </div>
    </nav>
  );
});