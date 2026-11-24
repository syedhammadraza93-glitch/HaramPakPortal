import { Navigate, Route, Routes } from "react-router-dom";
import { PortalLayout } from "../layout/PortalLayout";
import { Security } from "../pages/account/Security";
import { AdminDashboard } from "../pages/admin/AdminDashboard";
import { Agencies } from "../pages/admin/Agencies";
import { AgencyDetail } from "../pages/admin/AgencyDetail";
import { AuditLog } from "../pages/admin/AuditLog";
import { CatalogueSetup } from "../pages/admin/catalogue/CatalogueSetup";
import { BookingDetail as AdminBookingDetail } from "../pages/admin/bookings/BookingDetail";
import { Bookings as AdminBookings } from "../pages/admin/bookings/Bookings";
import { Notifications } from "../pages/account/Notifications";
import { Announcements } from "../pages/admin/Announcements";
import { Reports } from "../pages/admin/reports/Reports";
import { AgencyLedger } from "../pages/admin/finance/AgencyLedger";
import { Finance } from "../pages/admin/finance/Finance";
import { PaymentDetail } from "../pages/admin/finance/PaymentDetail";
import { AgentLedger } from "../pages/agent/ledger/AgentLedger";
import { PackageEditor } from "../pages/admin/packages/PackageEditor";
import { Packages } from "../pages/admin/packages/Packages";
import { Pricing } from "../pages/admin/pricing/Pricing";
import { Roles } from "../pages/admin/Roles";
import { SettingsPage } from "../pages/admin/Settings";
import { Users } from "../pages/admin/Users";
import { AgentDashboard } from "../pages/agent/AgentDashboard";
import { AgentProfile } from "../pages/agent/AgentProfile";
import { AgentPackageDetail } from "../pages/agent/catalogue/AgentPackageDetail";
import { AgentPackages } from "../pages/agent/catalogue/AgentPackages";
import { AgentVisaRates } from "../pages/agent/catalogue/AgentVisaRates";
import { AgentBooking } from "../pages/agent/bookings/AgentBooking";
import { MyBookings } from "../pages/agent/bookings/MyBookings";
import { ForgotPassword } from "../pages/auth/ForgotPassword";
import { Login } from "../pages/auth/Login";
import { Register } from "../pages/auth/Register";
import { ResetPassword } from "../pages/auth/ResetPassword";
import { VerifyEmail } from "../pages/auth/VerifyEmail";
import { useAppSelector } from "../redux/hooks";
import { GuestRoute, ProtectedRoute, homeFor } from "./ProtectedRoute";
import { LeadDetail, LeadWorkspace } from "../pages/admin/crm/LeadWorkspace";
import { WebsiteContentPage } from "../pages/admin/WebsiteContent";
import { MetaSettings } from "../pages/admin/MetaSettings";
import { Spinner } from "../components/ui";

function Home() {
  const { user, status } = useAppSelector((s) => s.auth);
  if (status === "loading") return <Spinner className="min-h-screen" />;
  return <Navigate to={user ? homeFor(user.type) : "/login"} replace />;
}

function AdminHome() {
  const { user } = useAppSelector(state => state.auth);
  if (user?.permissions.includes("dashboard.admin")) return <AdminDashboard />;
  if (user?.permissions.includes("crm.work")) return <Navigate to="crm" replace />;
  if (user?.permissions.some(permission => permission === "website.edit" || permission === "website.publish")) return <Navigate to="website" replace />;
  return <p className="text-sm text-slate-700">Use the sidebar to open the areas assigned to your account.</p>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />

      {/* Public */}
      <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
      <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
      <Route path="/register/success" element={<Navigate to="/verify-email" replace />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Agent portal */}
      <Route path="/agent" element={<ProtectedRoute type="agent"><PortalLayout area="agent" /></ProtectedRoute>}>
        <Route index element={<AgentDashboard />} />
        <Route path="profile" element={<AgentProfile />} />
        <Route path="packages" element={<ProtectedRoute type="agent" agencyModule="catalogue"><AgentPackages /></ProtectedRoute>} />
        <Route path="packages/:id" element={<ProtectedRoute type="agent" agencyModule="catalogue"><AgentPackageDetail /></ProtectedRoute>} />
        <Route path="visa-rates" element={<ProtectedRoute type="agent" agencyModule="catalogue"><AgentVisaRates /></ProtectedRoute>} />
        <Route path="bookings" element={<ProtectedRoute type="agent" agencyModule="bookings"><MyBookings /></ProtectedRoute>} />
        <Route path="bookings/:id" element={<ProtectedRoute type="agent" agencyModule="bookings"><AgentBooking /></ProtectedRoute>} />
        <Route path="ledger" element={<ProtectedRoute type="agent" agencyModule="finance"><AgentLedger /></ProtectedRoute>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="security" element={<Security />} />
      </Route>

      {/* Admin portal */}
      <Route path="/admin" element={<ProtectedRoute type="staff"><PortalLayout area="admin" /></ProtectedRoute>}>
        <Route index element={<AdminHome />} />
        <Route path="crm" element={<ProtectedRoute type="staff" permission="crm.work"><LeadWorkspace /></ProtectedRoute>} />
        <Route path="crm/leads/:id" element={<ProtectedRoute type="staff" permission="crm.work"><LeadDetail /></ProtectedRoute>} />
        <Route path="website" element={<ProtectedRoute type="staff" anyPermissions={["website.edit", "website.publish"]}><WebsiteContentPage /></ProtectedRoute>} />
        <Route path="integrations/meta" element={<ProtectedRoute type="staff" permission="integration.manage"><MetaSettings /></ProtectedRoute>} />
        <Route path="agencies" element={<ProtectedRoute type="staff" permission="agent.view"><Agencies /></ProtectedRoute>} />
        <Route path="agencies/:id" element={<ProtectedRoute type="staff" permission="agent.view"><AgencyDetail /></ProtectedRoute>} />
        <Route path="bookings" element={<ProtectedRoute type="staff" permission="booking.view"><AdminBookings /></ProtectedRoute>} />
        <Route path="bookings/:id" element={<ProtectedRoute type="staff" permission="booking.view"><AdminBookingDetail /></ProtectedRoute>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="reports" element={<ProtectedRoute type="staff" permission="report.view"><Reports /></ProtectedRoute>} />
        <Route path="announcements" element={<ProtectedRoute type="staff" permission="announcement.manage"><Announcements /></ProtectedRoute>} />
        <Route path="finance" element={<ProtectedRoute type="staff" permission="finance.view"><Finance /></ProtectedRoute>} />
        <Route path="finance/agencies/:id" element={<ProtectedRoute type="staff" permission="finance.view"><AgencyLedger /></ProtectedRoute>} />
        <Route path="finance/payments/:id" element={<ProtectedRoute type="staff" permission="finance.view"><PaymentDetail /></ProtectedRoute>} />
        <Route path="packages" element={<ProtectedRoute type="staff" permission="catalogue.view"><Packages /></ProtectedRoute>} />
        <Route path="packages/:id" element={<ProtectedRoute type="staff" permission="catalogue.view"><PackageEditor /></ProtectedRoute>} />
        <Route path="catalogue" element={<ProtectedRoute type="staff" permission="catalogue.manage"><CatalogueSetup /></ProtectedRoute>} />
        <Route path="pricing" element={<ProtectedRoute type="staff" permission="pricing.manage"><Pricing /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute type="staff" permission="user.manage"><Users /></ProtectedRoute>} />
        <Route path="roles" element={<ProtectedRoute type="staff" permission="role.manage"><Roles /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute type="staff" permission="settings.manage"><SettingsPage /></ProtectedRoute>} />
        <Route path="audit-log" element={<ProtectedRoute type="staff" permission="audit.view"><AuditLog /></ProtectedRoute>} />
        <Route path="security" element={<Security />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
