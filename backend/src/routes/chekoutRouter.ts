import { Router } from "express";
import { confirmCheckout, createCheckout } from "../controllers/checkoutController";

const router = Router();

router.post("/", createCheckout);
router.post("/confirm", confirmCheckout);

export default router;
