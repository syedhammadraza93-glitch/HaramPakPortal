import { Router } from "express";
import { listAuditLog } from "../controllers/auditLog.controller";
import { jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

const router = Router();
router.use(jwtGuard, requirePermission("audit.view"));

router.get("/", h(listAuditLog));

export default router;
