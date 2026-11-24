import {
  BadgePercent, BarChart3, BookOpen, Megaphone, MapPinned, Stamp, Building2, ClipboardList, KeyRound, LayoutDashboard, LogOut, Menu, Plane, Settings, ShieldCheck, UserCog, Users, Wallet, X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useBranding } from "../branding/BrandingProvider";
import { BrandName, Logo } from "../components/Logo";
import { AnnouncementBar } from "../components/AnnouncementBar";
import { NotificationBell } from "../components/NotificationBell";
import { Badge, StatusBadge, cx } from "../components/ui";
import { useAppDispatch, useMe } from "../redux/hooks";
import { logout } from "../redux/slices/authSlice";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  anyPermissions?: string[];
  /** Shown greyed out with the phase it arrives in. */
  soon?: string;
  /** Only for approved agencies (packages and prices). */
  activeAgencyOnly?: boolean;
  module?: "catalogue" | "bookings" | "finance";
  end?: boolean;
}

const AGENT_NAV: NavItem[] = [
  { to: "/agent", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/agent/profile", label: "My agency", icon: Building2 },
  { to: "/agent/packages", label: "Packages", icon: Plane, activeAgencyOnly: true, module: "catalogue" },
  { to: "/agent/visa-rates", label: "Visa rates", icon: Stamp, activeAgencyOnly: true, module: "catalogue" },
  { to: "/agent/bookings", label: "My bookings", icon: BookOpen, activeAgencyOnly: true, module: "bookings" },
  { to: "/agent/ledger", label: "Ledger & payments", icon: Wallet, activeAgencyOnly: true, module: "finance" },
  { to: "/agent/security", label: "Account & security", icon: KeyRound },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.admin", end: true },
  { to: "/admin/crm", label: "Leads", icon: ClipboardList, permission: "crm.work" },
  { to: "/admin/website", label: "Website content", icon: BookOpen, anyPermissions: ["website.edit", "website.publish"] },
  { to: "/admin/integrations/meta", label: "Meta integration", icon: Settings, permission: "integration.manage" },
  { to: "/admin/agencies", label: "Agencies", icon: Building2, permission: "agent.view" },
  { to: "/admin/bookings", label: "Bookings", icon: BookOpen, permission: "booking.view" },
  { to: "/admin/finance", label: "Finance", icon: Wallet, permission: "finance.view" },
  { to: "/admin/reports", label: "Reports", icon: BarChart3, permission: "report.view" },
  { to: "/admin/announcements", label: "Announcements", icon: Megaphone, permission: "announcement.manage" },
  { to: "/admin/packages", label: "Packages", icon: Plane, permission: "catalogue.view" },
  { to: "/admin/catalogue", label: "Catalogue setup", icon: MapPinned, permission: "catalogue.manage" },
  { to: "/admin/pricing", label: "Pricing", icon: BadgePercent, permission: "pricing.manage" },
  { to: "/admin/users", label: "Staff users", icon: Users, permission: "user.manage" },
  { to: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck, permission: "role.manage" },
  { to: "/admin/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
  { to: "/admin/audit-log", label: "Audit log", icon: ClipboardList, permission: "audit.view" },
  { to: "/admin/security", label: "Account & security", icon: UserCog },
];

export function PortalLayout({ area }: { area: "agent" | "admin" }) {
  const me = useMe();
  const branding = useBranding();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = (area === "agent" ? AGENT_NAV : ADMIN_NAV).filter((i) => (!i.permission || me?.permissions.includes(i.permission)) && (!i.anyPermissions || i.anyPermissions.some(permission => me?.permissions.includes(permission))) && (!i.activeAgencyOnly || me?.agency?.status === "active") && (!i.module || me?.agency?.access[i.module]));

  const onLogout = async () => {
    await dispatch(logout());
    navigate("/login", { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-800 text-brand-50">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <Logo size={42} />
        <BrandName light />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) =>
          item.soon ? (
            <div key={item.label} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-200/60" title={`Coming in ${item.soon}`}>
              <item.icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{item.soon}</span>
            </div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-white text-brand-800 shadow-sm" : "text-brand-50 hover:bg-white/10",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ),
        )}
      </nav>
      {(branding.tagline || branding.footerText) && (
        <div className="border-t border-white/10 p-4 text-xs text-brand-200">
          {branding.tagline && <p className="font-semibold text-gold-400">{branding.tagline}</p>}
          {branding.footerText && <p className="mt-0.5">{branding.footerText}</p>}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%]">{sidebar}</div>
          <button className="absolute top-4 right-4 rounded-lg bg-white/90 p-1.5" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <div className="sticky top-0 z-20">
          {area === "agent" && me && <AnnouncementBar key={me.id} />}
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
            <button className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              {me?.agency ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-slate-800">{me.agency.name}</span>
                  {me.agency.agentCode && <Badge tone="green">{me.agency.agentCode}</Badge>}
                  <StatusBadge status={me.agency.status} />
                </div>
              ) : (
                <span className="font-semibold text-slate-800">Admin portal</span>
              )}
            </div>
            <NotificationBell allPath={area === "agent" ? "/agent/notifications" : "/admin/notifications"} />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-800">{me?.fullName}</p>
              <p className="text-xs text-slate-500">{me?.email}</p>
            </div>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-accent-200 hover:bg-accent-50 hover:text-accent-600"
            >
              <LogOut className="size-4" /> <span className="hidden sm:inline">Log out</span>
            </button>
          </header>
        </div>
        <main className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
