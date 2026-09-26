import { eq, sql } from "drizzle-orm";
import { db } from "./client.js";
import { members, projectMembers, users } from "./schema.js";

export type UserAccountRecord = typeof users.$inferSelect;
export type UserAccountStatus = "active" | "disabled";
export type BootstrapUserAccountInput = {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  legacyAuthSubject: string | null;
  legacyAuthSubjectExpiresAt: Date | null;
  now: Date;
};

export type UserAccountSummary = Pick<UserAccountRecord, "id" | "username" | "status">;

export async function findUserAccountByUsernameKey(usernameKey: string): Promise<UserAccountRecord | undefined> {
  const [user] = await db.select().from(users).where(eq(users.usernameKey, usernameKey)).limit(1);
  return user;
}

export async function findUserAccountById(id: string): Promise<UserAccountRecord | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

export async function findUserAccountByLegacySubject(subject: string): Promise<UserAccountRecord | undefined> {
  const [user] = await db.select().from(users).where(eq(users.legacyAuthSubject, subject)).limit(1);
  return user;
}

export async function updateUserAccountPasswordHash(id: string, passwordHash: string, changedAt: Date): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: changedAt, updatedAt: changedAt })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return updated.length > 0;
}

export async function listUserAccounts(): Promise<UserAccountSummary[]> {
  return db
    .select({ id: users.id, username: users.username, status: users.status })
    .from(users)
    .orderBy(users.createdAt);
}

export async function createUserAccount(input: {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  now: Date;
}): Promise<Pick<UserAccountRecord, "id" | "username"> | undefined> {
  const { now, ...account } = input;
  const [created] = await db
    .insert(users)
    .values({
      ...account,
      status: "active",
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: users.id, username: users.username });
  return created;
}

export async function setUserAccountStatus(
  id: string,
  status: UserAccountStatus,
  changedAt: Date,
): Promise<Pick<UserAccountRecord, "id" | "username"> | undefined> {
  const [updated] = await db
    .update(users)
    .set({ status, disabledAt: status === "disabled" ? changedAt : null, updatedAt: changedAt })
    .where(eq(users.id, id))
    .returning({ id: users.id, username: users.username });
  return updated;
}

export async function resetUserAccountPassword(
  id: string,
  passwordHash: string,
  changedAt: Date,
): Promise<Pick<UserAccountRecord, "id" | "username"> | undefined> {
  const [updated] = await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: changedAt, updatedAt: changedAt })
    .where(eq(users.id, id))
    .returning({ id: users.id, username: users.username });
  return updated;
}

export async function bootstrapFirstUserAccount(
  createAccount: () => Promise<BootstrapUserAccountInput>,
): Promise<"created" | "already-initialized"> {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('langreport:database-users-bootstrap', 0))`,
    );

    const [existing] = await transaction.select({ id: users.id }).from(users).limit(1);
    if (existing) return "already-initialized";

    const input = await createAccount();
    const { now, ...account } = input;
    await transaction.insert(users).values({
      ...account,
      status: "active",
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    });

    if (input.legacyAuthSubject) {
      await transaction.update(members).set({ userId: input.id }).where(eq(members.userId, input.legacyAuthSubject));
      await transaction
        .update(projectMembers)
        .set({ userId: input.id })
        .where(eq(projectMembers.userId, input.legacyAuthSubject));
    }

    return "created";
  });
}
