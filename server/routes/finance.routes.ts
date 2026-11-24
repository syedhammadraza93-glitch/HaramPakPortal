import { Router } from "express";
import {
  downloadMyPaymentFile, getMyPayment, myPayments, myStatement, mySummary, replyOnPayment, submitMyPayment,
} from "../controllers/agentFinance.controller";
import {
  addBookingCost, agencyStatementForStaff, approveRequest, bookingFinance, closePeriod, createBankAccount, createRequest, createSupplier, deleteBookingCost,
  downloadPaymentAttachment, financeOptions, financeSummary, getAgencyFinance, getJournalEntry, getPayment, listAccounts, listAgencyBalances, listJournal,
  listPayments, listPeriods, listRequests, listSuppliers, recordPayment, rejectRequest, reopenPeriod, reviewPaymentHandler, updateAccount, updateAgencyCredit,
  updateBookingCost, updateSupplier, verifyPaymentHandler,
} from "../controllers/finance.controller";
import { jwtGuard, requireAgencyAccess, requirePermission as can } from "../middleware/auth.middleware";
import { paymentReceiptsUpload } from "../middleware/upload";
import { asyncHandler as h } from "../utils/http";

/** /api/admin/finance: view = finance.view, actions = finance.manage, approvals and month closing = finance.approve. */
export const adminFinanceRoutes = Router();
adminFinanceRoutes.use(jwtGuard);
const view = can("finance.view");
const manage = can("finance.manage");
const approve = can("finance.approve");

adminFinanceRoutes.get("/summary", view, h(financeSummary));
adminFinanceRoutes.get("/options", view, h(financeOptions));

adminFinanceRoutes.get("/agencies", view, h(listAgencyBalances));
adminFinanceRoutes.get("/agencies/:id", view, h(getAgencyFinance));
adminFinanceRoutes.get("/agencies/:id/statement", view, h(agencyStatementForStaff));
adminFinanceRoutes.put("/agencies/:id/credit", manage, h(updateAgencyCredit));

adminFinanceRoutes.get("/payments", view, h(listPayments));
adminFinanceRoutes.post("/payments", manage, paymentReceiptsUpload, h(recordPayment));
adminFinanceRoutes.get("/payments/:id", view, h(getPayment));
adminFinanceRoutes.post("/payments/:id/verify", manage, h(verifyPaymentHandler));
adminFinanceRoutes.post("/payments/:id/reject", manage, h(reviewPaymentHandler("rejected")));
adminFinanceRoutes.post("/payments/:id/clarify", manage, h(reviewPaymentHandler("clarification")));
adminFinanceRoutes.get("/payments/:id/attachments/:attachmentId", view, h(downloadPaymentAttachment));

adminFinanceRoutes.get("/requests", view, h(listRequests));
adminFinanceRoutes.post("/requests", manage, h(createRequest));
adminFinanceRoutes.post("/requests/:id/approve", approve, h(approveRequest));
adminFinanceRoutes.post("/requests/:id/reject", manage, h(rejectRequest));

adminFinanceRoutes.get("/journal", view, h(listJournal));
adminFinanceRoutes.get("/journal/:id", view, h(getJournalEntry));

adminFinanceRoutes.get("/accounts", view, h(listAccounts));
adminFinanceRoutes.post("/accounts", manage, h(createBankAccount));
adminFinanceRoutes.patch("/accounts/:id", manage, h(updateAccount));

adminFinanceRoutes.get("/periods", view, h(listPeriods));
adminFinanceRoutes.post("/periods", approve, h(closePeriod));
adminFinanceRoutes.post("/periods/:month/reopen", approve, h(reopenPeriod));

adminFinanceRoutes.get("/suppliers", view, h(listSuppliers));
adminFinanceRoutes.post("/suppliers", manage, h(createSupplier));
adminFinanceRoutes.patch("/suppliers/:id", manage, h(updateSupplier));

adminFinanceRoutes.get("/bookings/:bookingId", view, h(bookingFinance));
adminFinanceRoutes.post("/bookings/:bookingId/costs", manage, h(addBookingCost));
adminFinanceRoutes.patch("/costs/:costId", manage, h(updateBookingCost));
adminFinanceRoutes.delete("/costs/:costId", manage, h(deleteBookingCost));

/** /api/agent/finance: the agent's own agency only. */
export const agentFinanceRoutes = Router();
agentFinanceRoutes.use(jwtGuard, can("portal.agent"), requireAgencyAccess("finance"));
agentFinanceRoutes.get("/summary", h(mySummary));
agentFinanceRoutes.get("/statement", h(myStatement));
agentFinanceRoutes.get("/payments", h(myPayments));
agentFinanceRoutes.post("/payments", paymentReceiptsUpload, h(submitMyPayment));
agentFinanceRoutes.get("/payments/:id", h(getMyPayment));
agentFinanceRoutes.post("/payments/:id/reply", paymentReceiptsUpload, h(replyOnPayment));
agentFinanceRoutes.get("/payments/:id/attachments/:attachmentId", h(downloadMyPaymentFile));
