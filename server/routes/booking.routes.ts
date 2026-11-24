import { Router } from "express";
import {
  answerQuotation, cancelMyBooking, createBooking, deleteMyDocument, downloadMyDocument, getMyBooking, listMyBookings, myBookingSummary,
  postMyMessage, saveMyBooking, submitMyBooking, uploadMyDocument,
} from "../controllers/agentBooking.controller";
import {
  createCharge, createStage, deleteCharge, deleteStage, getBookingSettings, listCharges, listStages, updateBookingSettings, updateCharge, updateStage,
} from "../controllers/bookingSetup.controller";
import {
  bookingSummary, changeBookingStatus, downloadDocument, getBooking, issueDocument, listBookings, postMessage, reviewDocument, sendQuotation, setStage,
} from "../controllers/opsBooking.controller";
import { jwtGuard, requireAgencyAccess, requirePermission as can } from "../middleware/auth.middleware";
import { singleDocumentUpload } from "../middleware/upload";
import { asyncHandler as h } from "../utils/http";

/** /api/agent/bookings: the agent's own agency only. */
export const agentBookingRoutes = Router();
agentBookingRoutes.use(jwtGuard, can("portal.agent"), requireAgencyAccess("bookings"));
agentBookingRoutes.get("/summary", h(myBookingSummary));
agentBookingRoutes.get("/", h(listMyBookings));
agentBookingRoutes.post("/", requireAgencyAccess("catalogue"), h(createBooking));
agentBookingRoutes.get("/:id", h(getMyBooking));
agentBookingRoutes.put("/:id", h(saveMyBooking));
agentBookingRoutes.post("/:id/submit", h(submitMyBooking));
agentBookingRoutes.post("/:id/resubmit", h(submitMyBooking));
agentBookingRoutes.post("/:id/cancel", h(cancelMyBooking));
agentBookingRoutes.post("/:id/quotation/:decision", h(answerQuotation));
agentBookingRoutes.post("/:id/documents", singleDocumentUpload, h(uploadMyDocument));
agentBookingRoutes.get("/:id/documents/:documentId", h(downloadMyDocument));
agentBookingRoutes.delete("/:id/documents/:documentId", h(deleteMyDocument));
agentBookingRoutes.post("/:id/messages", h(postMyMessage));

/** /api/admin/bookings: Operations. */
export const adminBookingRoutes = Router();
adminBookingRoutes.use(jwtGuard);
adminBookingRoutes.get("/summary", can("booking.view"), h(bookingSummary));
adminBookingRoutes.get("/", can("booking.view"), h(listBookings));
adminBookingRoutes.get("/:id", can("booking.view"), h(getBooking));
adminBookingRoutes.post("/:id/status/:action", can("booking.manage"), h(changeBookingStatus));
adminBookingRoutes.post("/:id/quotation", can("booking.manage"), h(sendQuotation));
adminBookingRoutes.patch("/:id/documents/:documentId", can("booking.manage"), h(reviewDocument));
adminBookingRoutes.post("/:id/documents", can("booking.manage"), singleDocumentUpload, h(issueDocument));
adminBookingRoutes.get("/:id/documents/:documentId", can("booking.view"), h(downloadDocument));
adminBookingRoutes.post("/:id/messages", can("booking.manage"), h(postMessage));
adminBookingRoutes.put("/:id/stages/:stageId", can("booking.manage"), h(setStage));

/** /api/admin/booking-setup: taxes and charges, operational stages, booking settings. */
export const bookingSetupRoutes = Router();
bookingSetupRoutes.use(jwtGuard);
bookingSetupRoutes.get("/charges", can("catalogue.view"), h(listCharges));
bookingSetupRoutes.post("/charges", can("pricing.manage"), h(createCharge));
bookingSetupRoutes.put("/charges/:id", can("pricing.manage"), h(updateCharge));
bookingSetupRoutes.delete("/charges/:id", can("pricing.manage"), h(deleteCharge));
bookingSetupRoutes.get("/stages", can("booking.view"), h(listStages));
bookingSetupRoutes.post("/stages", can("catalogue.manage"), h(createStage));
bookingSetupRoutes.put("/stages/:id", can("catalogue.manage"), h(updateStage));
bookingSetupRoutes.delete("/stages/:id", can("catalogue.manage"), h(deleteStage));
bookingSetupRoutes.get("/settings", can("booking.view"), h(getBookingSettings));
bookingSetupRoutes.put("/settings", can("settings.manage"), h(updateBookingSettings));
