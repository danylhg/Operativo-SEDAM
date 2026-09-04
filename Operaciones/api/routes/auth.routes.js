import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { issueWearSession, login, me } from "../controllers/auth.controller.js";

const router = Router();

router.post("/auth/login", login);
router.post("/auth/wear/session", requireAuth, issueWearSession);
router.get("/me", requireAuth, me);

export default router;
