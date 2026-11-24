import { Router } from "express";
import {
  announcementOptions, createAnnouncement, deleteAnnouncement, getNotificationSettings, listAnnouncements, listDocumentTemplates, listNotifications, markAllRead,
  markRead, myAnnouncements, unreadCount, updateAnnouncement, updateDocumentTemplate, updateNotificationSettings,
} from "../controllers/communication.controller";
import { adminDashboard, agentDashboard } from "../controllers/dashboard.controller";
import {
  agentBookingDocument, agentBrochure, agentEntryDocument, agentPaymentReceipt, agentStatement, getReport, listReports, staffBookingDocument, staffBrochure,
  staffDepartureList, staffEntryDocument, staffPaymentReceipt, staffStatement,
} from "../controllers/document.controller";
import { jwtGuard, requireAgencyAccess, requirePermission as can } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

/** /api/notifications: any logged-in user, own notifications only. */
export const notificationRoutes = Router();
notificationRoutes.use(jwtGuard);
notificationRoutes.get("/", h(listNotifications));
notificationRoutes.get("/unread-count", h(unreadCount));
notificationRoutes.post("/read-all", h(markAllRead));
notificationRoutes.post("/:id/read", h(markRead));

/** /api/agent/…: dashboard, announcements and documents for the agent's own agency. */
export const agentCommunicationRoutes = Router();
agentCommunicationRoutes.use(jwtGuard, can("portal.agent"));
agentCommunicationRoutes.get("/dashboard", h(agentDashboard));
agentCommunicationRoutes.get("/announcements", h(myAnnouncements));
agentCommunicationRoutes.get("/documents/bookings/:id/:doc", requireAgencyAccess("bookings"), h(agentBookingDocument));
agentCommunicationRoutes.get("/documents/payments/:id/receipt", requireAgencyAccess("finance"), h(agentPaymentReceipt));
agentCommunicationRoutes.get("/documents/entries/:entryId", requireAgencyAccess("finance"), h(agentEntryDocument));
agentCommunicationRoutes.get("/documents/statement", requireAgencyAccess("finance"), h(agentStatement));
agentCommunicationRoutes.get("/documents/packages/:id/brochure", requireAgencyAccess("catalogue"), h(agentBrochure));

/** /api/admin/…: dashboard, documents, reports, announcements, notification and document settings. */
export const adminCommunicationRoutes = Router();
adminCommunicationRoutes.use(jwtGuard);
adminCommunicationRoutes.get("/dashboard", can("dashboard.admin"), h(adminDashboard));

adminCommunicationRoutes.get("/documents/bookings/:id/:doc", can("booking.view"), h(staffBookingDocument));
adminCommunicationRoutes.get("/documents/departures/:id/passenger-list", can("booking.view"), h(staffDepartureList));
adminCommunicationRoutes.get("/documents/packages/:id/brochure", can("catalogue.view"), h(staffBrochure));
adminCommunicationRoutes.get("/documents/payments/:id/receipt", can("finance.view"), h(staffPaymentReceipt));
adminCommunicationRoutes.get("/documents/entries/:entryId", can("finance.view"), h(staffEntryDocument));
adminCommunicationRoutes.get("/documents/agencies/:id/statement", can("finance.view"), h(staffStatement));

adminCommunicationRoutes.get("/reports", can("report.view"), h(listReports));
adminCommunicationRoutes.get("/reports/:key", can("report.view"), h(getReport));

adminCommunicationRoutes.get("/announcements", can("announcement.manage"), h(listAnnouncements));
adminCommunicationRoutes.get("/announcements/options", can("announcement.manage"), h(announcementOptions));
adminCommunicationRoutes.post("/announcements", can("announcement.manage"), h(createAnnouncement));
adminCommunicationRoutes.put("/announcements/:id", can("announcement.manage"), h(updateAnnouncement));
adminCommunicationRoutes.delete("/announcements/:id", can("announcement.manage"), h(deleteAnnouncement));

adminCommunicationRoutes.get("/settings/notifications", can("settings.manage"), h(getNotificationSettings));
adminCommunicationRoutes.put("/settings/notifications", can("settings.manage"), h(updateNotificationSettings));
adminCommunicationRoutes.get("/settings/documents", can("settings.manage"), h(listDocumentTemplates));
adminCommunicationRoutes.put("/settings/documents/:type", can("settings.manage"), h(updateDocumentTemplate));
