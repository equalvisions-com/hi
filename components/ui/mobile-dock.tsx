"use client";

import Link from "next/link";
import { 
  Home, 
  Podcast,
  Mail,
  User,
  Bookmark,
  MessageCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { memo, useMemo, useCallback } from "react";
import { useSidebar } from "@/components/ui/sidebar-context";

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
      "flex flex-col items-center justify-center px-2 pb-2 relative",
      "transition-colors duration-200 ease-in-out h-12 w-12",
      isActive 
        ? "text-primary" 
        : "text-muted-foreground hover:text-foreground"
    )}
    aria-current={isActive ? "page" : undefined}
  >
    <item.icon 
      size={22} 
      strokeWidth={2.25}
    />
    <span className="sr-only">{item.label}</span>
  </Link>
));

NavItem.displayName = "NavItem";

// The main component is also memoized to prevent unnecessary re-renders
export const MobileDock = memo(function MobileDock({ className }: MobileDockProps) {
  const pathname = usePathname();
  const { username, isAuthenticated } = useSidebar();
  
  // Memoize the navItems array to prevent recreation on each render
  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { href: "/", icon: Home, label: "Home" },
      { href: "/newsletters", icon: Mail, label: "Newsletters" },
      { href: "/podcasts", icon: Podcast, label: "Podcasts" },
      { href: "/chat", icon: MessageCircle, label: "AI Chat" },
    ];
    
    // Add bookmarks only if authenticated
    if (isAuthenticated) {
      items.push({ href: "/bookmarks", icon: Bookmark, label: "Bookmarks" });
    }
    
    // Add profile link based on authentication status
    items.push(
      isAuthenticated 
        ? { href: `/@${username}`, icon: User, label: "Profile" }
        : { href: "/signin", icon: User, label: "Sign In" }
    );
    
    return items;
  }, [username, isAuthenticated]);

  // Memoize the isActive check function
  const checkIsActive = useCallback((href: string) => {
    if (href === '/') return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  }, [pathname]);

  return (
    <nav 
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 content-center md:hidden",
        "bg-background/85 backdrop-blur-md border-t border-border",
        "flex flex-col",
        className
      )}
      style={{ 
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        height: "calc(64px + env(safe-area-inset-bottom, 0px))"
      }}
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-around w-full h-[64px] pt-2">
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

