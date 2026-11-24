import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "../components/ui";
import { useAppSelector } from "../redux/hooks";

/** Redirects to /login when logged out, and to the right portal when the user type does not match. */
export function ProtectedRoute({ type, permission, anyPermissions, agencyModule, children }: { type: "agent" | "staff"; permission?: string; anyPermissions?: string[]; agencyModule?: "catalogue" | "bookings" | "finance"; children: ReactNode }) {
  const { user, status } = useAppSelector((s) => s.auth);
  const location = useLocation();

  if (status === "loading") return <Spinner className="min-h-screen" label="Loading your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.type !== type) return <Navigate to={homeFor(user.type)} replace />;
  if (permission && !user.permissions.includes(permission)) return <Navigate to={homeFor(user.type)} replace />;
  if (anyPermissions && !anyPermissions.some(item => user.permissions.includes(item))) return <Navigate to={homeFor(user.type)} replace />;
  if (agencyModule && (user.agency?.status !== "active" || !user.agency.access[agencyModule])) return <Navigate to="/agent" replace />;
  return <>{children}</>;
}

export const homeFor = (type: "agent" | "staff") => (type === "agent" ? "/agent" : "/admin");

/** For login/register pages: logged-in users go straight to their portal. */
export function GuestRoute({ children }: { children: ReactNode }) {
  const { user, status } = useAppSelector((s) => s.auth);
  if (status === "loading") return <Spinner className="min-h-screen" label="Loading…" />;
  if (user) return <Navigate to={homeFor(user.type)} replace />;
  return <>{children}</>;
}
