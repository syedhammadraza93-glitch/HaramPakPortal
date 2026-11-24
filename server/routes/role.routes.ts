import { Router } from "express";
import { createRole, listPermissions, listRoles, updateRole } from "../controllers/role.controller";
import { jwtGuard, requirePermission as can } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

const router = Router();
router.use(jwtGuard);

// Readable by any admin-portal user (needed to assign roles to users).
router.get("/roles", can("dashboard.admin"), h(listRoles));
router.get("/permissions", can("role.manage"), h(listPermissions));
router.post("/roles", can("role.manage"), h(createRole));
router.patch("/roles/:id", can("role.manage"), h(updateRole));

export default router;
