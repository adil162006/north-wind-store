import type { Request, Response, NextFunction } from "express";
import { getEnv } from "../lib/env";
import z from "zod";
import { getAuth } from "@clerk/express";
import { getLocalUser } from "../lib/users";
import { db } from "../db";
import { CheckoutSessionLine, checkoutSessions, orders, products } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { polarCreateCheckout, polarGetCheckoutStatus } from "../lib/polar";
import { fulfillCheckoutSession } from "../lib/checkoutFulfillment";

const env = getEnv();

const cartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const confirmCheckoutSchema = z.object({
  checkoutId: z.string().min(1).max(255),
});

export async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    // only signed-in users can start checkout
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = cartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid cart", details: parsed.error.flatten() });
      return;
    }

    // polar access token is required
    if (!env.POLAR_ACCESS_TOKEN) {
      res.status(503).json({ error: "Payments are not configured" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }

    const ids = parsed.data.items.map((i) => i.productId);

    // load every cart product that exists, is active, and matches the IDs we asked for.
    const prodRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.active, true)));

    if (prodRows.length !== ids.length) {
      res.status(400).json({ error: "One or more products are invalid" });
      return;
    }

    const byId = new Map(prodRows.map((p) => [p.id, p]));
    let totalCents = 0;
    const lines: CheckoutSessionLine[] = [];

    for (const line of parsed.data.items) {
      const p = byId.get(line.productId)!;
      totalCents += p.priceCents * line.quantity;
      lines.push({
        productId: p.id,
        quantity: line.quantity,
        unitPriceCents: p.priceCents,
      });
    }

    if (totalCents < 10) {
      res.status(400).json({
        error: "Total below Polar minimum (e.g. USD requires at least 10 cents)",
      });
      return;
    }

    const [session] = await db
      .insert(checkoutSessions)
      .values({
        userId: localUser.id,
        lines,
        totalCents,
        currency: "usd",
      })
      .returning();

    const successUrl = `${env.FRONTEND_URL}/checkout/return?checkout_id={CHECKOUT_ID}`;
    const returnUrl = `${env.FRONTEND_URL}/cart`;

    const checkout = await polarCreateCheckout(env, {
      products: [env.POLAR_CHECKOUT_PRODUCT_ID],
      prices: {
        [env.POLAR_CHECKOUT_PRODUCT_ID]: [
          {
            amount_type: "fixed",
            price_currency: "usd",
            price_amount: totalCents,
          },
        ],
      },

      success_url: successUrl,
      return_url: returnUrl,
      external_customer_id: userId,
      metadata: { checkout_session_id: session.id },
    });

    await db
      .update(checkoutSessions)
      .set({ polarCheckoutId: checkout.id })
      .where(eq(checkoutSessions.id, session.id));

    res.json({ checkoutUrl: checkout.url });
  } catch (e) {
    next(e);
  }
}

export async function confirmCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = confirmCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid checkout ID" });
      return;
    }

    if (!env.POLAR_ACCESS_TOKEN) {
      res.status(503).json({ error: "Payments are not configured" });
      return;
    }

    const localUser = await getLocalUser(userId);
    const checkoutId = parsed.data.checkoutId;

    const [existingOrder] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.polarCheckoutId, checkoutId), eq(orders.userId, localUser.id)))
      .limit(1);

    if (existingOrder) {
      res.json({
        status: existingOrder.status === "paid" ? "succeeded" : existingOrder.status,
        orderId: existingOrder.id,
      });
      return;
    }

    const [session] = await db
      .select({ id: checkoutSessions.id })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.polarCheckoutId, checkoutId),
          eq(checkoutSessions.userId, localUser.id),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Checkout not found" });
      return;
    }

    const checkout = await polarGetCheckoutStatus(env, checkoutId);
    if (checkout.id !== checkoutId) {
      throw new Error("Polar returned a different checkout ID");
    }

    if (checkout.status !== "succeeded") {
      res.json({ status: checkout.status });
      return;
    }

    const orderId = await fulfillCheckoutSession(session.id, checkoutId, localUser.id);
    if (!orderId) {
      res.status(409).json({ error: "Checkout fulfillment failed" });
      return;
    }

    res.json({ status: "succeeded", orderId });
  } catch (e) {
    next(e);
  }
}
