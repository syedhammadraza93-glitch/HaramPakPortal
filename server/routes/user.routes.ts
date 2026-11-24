import { Router } from "express";
import { createUser, deleteUser, listUsers, resendInvite, unlockUser, updateUser } from "../controllers/user.controller";
import { jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

const router = Router();
router.use(jwtGuard, requirePermission("user.manage"));

router.get("/", h(listUsers));
router.post("/", h(createUser));
router.patch("/:id", h(updateUser));
router.delete("/:id", h(deleteUser));
router.post("/:id/unlock", h(unlockUser));
router.post("/:id/resend-invite", h(resendInvite));

export default router;
