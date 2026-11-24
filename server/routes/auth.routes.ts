import { Router } from "express";
import {
  acceptInvite, changePassword, forgotPassword, getCurrentUser, listSessions, login, logout, logoutAll,
  refresh, resendVerification, resetPassword, revokeSession, verifyEmail,
} from "../controllers/auth.controller";
import { getMfaStatus, loginWithMfa, resendLoginCode, setMfa } from "../controllers/mfa.controller";
import { jwtGuard } from "../middleware/auth.middleware";
import { emailLimiter, loginLimiter, tokenLimiter } from "../middleware/rateLimit";
import { asyncHandler as h } from "../utils/http";

const router = Router();

// Public
router.post("/login", loginLimiter, h(login));
router.post("/login/mfa", loginLimiter, h(loginWithMfa));
router.post("/login/mfa/resend", emailLimiter, h(resendLoginCode));
router.post("/refresh", h(refresh));
router.post("/logout", h(logout));
router.post("/verify-email", tokenLimiter, h(verifyEmail));
router.post("/resend-verification", emailLimiter, h(resendVerification));
router.post("/forgot-password", emailLimiter, h(forgotPassword));
router.post("/reset-password", tokenLimiter, h(resetPassword));
router.post("/accept-invite", tokenLimiter, h(acceptInvite));

// Logged in
router.get("/me", jwtGuard, h(getCurrentUser));
router.post("/logout-all", jwtGuard, h(logoutAll));
router.post("/change-password", jwtGuard, h(changePassword));
router.get("/sessions", jwtGuard, h(listSessions));
router.delete("/sessions/:id", jwtGuard, h(revokeSession));

// Two-factor login (emailed code)
router.get("/mfa", jwtGuard, h(getMfaStatus));
router.put("/mfa", jwtGuard, h(setMfa));

export default router;
