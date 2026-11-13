import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { parseRole } from "./roles.js";

export async function getLocalUser(clerkUserId: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (existing) return existing;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.emailAddresses.find((address) => address.id === clerkUser.primaryEmailAddressId)
      ?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";
  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.username ||
    null;

  await db
    .insert(users)
    .values({
      clerkUserId: clerkUser.id,
      email,
      displayName,
      role: parseRole(clerkUser.publicMetadata.role),
    })
    .onConflictDoNothing({ target: users.clerkUserId });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (!user) {
    throw new Error(`Failed to provision local user for Clerk user ${clerkUserId}`);
  }

  return user;
}
