import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { checkoutSessions, orderItems, orders } from "../db/schema.js";

export async function fulfillCheckoutSession(
  sessionId: string,
  checkoutId: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.id, sessionId),
          eq(checkoutSessions.polarCheckoutId, checkoutId),
          eq(checkoutSessions.userId, userId),
        ),
      )
      .for("update");

    if (!session) {
      const [existingOrder] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.polarCheckoutId, checkoutId), eq(orders.userId, userId)))
        .limit(1);

      return existingOrder?.id ?? null;
    }

    const [existingOrder] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.polarCheckoutId, checkoutId), eq(orders.userId, userId)))
      .limit(1);

    if (existingOrder) {
      await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
      return existingOrder.id;
    }

    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid",
        totalCents: session.totalCents,
        polarCheckoutId: checkoutId,
      })
      .returning({ id: orders.id });

    if (session.lines.length) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      );
    }

    await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));

    return order.id;
  });
}
