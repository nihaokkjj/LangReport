import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, db, members, projectMembers, projects, users, workspaces } from "@langreport/db";
import { buildApp } from "../../src/app.js";
import { createJwtAuthProvider, verifyLoginPassword } from "../../src/auth.js";
import { createDatabaseAuthAccountStore } from "../../src/user-account-store.js";
import { bootstrapDatabaseUser } from "../../src/user-bootstrap.js";

function signedToken(subject: string, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encode({ sub: subject, iat: issuedAt, exp: issuedAt + 300 });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

test("database bootstrap is atomic, idempotent, and migrates legacy member IDs with a bounded JWT alias", async () => {
  const suffix = randomUUID();
  const legacySubject = `legacy-${suffix}`;
  const migrationTrigger = `fail_account_migration_${suffix.replaceAll("-", "")}`;
  const migrationFunction = `${migrationTrigger}_fn`;
  const secret = "integration-login-secret-that-is-at-least-32-chars";
  let isolatedWorkspaceId: string | undefined;
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Accounts ${suffix}` })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: `Account migration ${suffix}`,
      slug: `account-migration-${suffix.slice(0, 8)}`,
    })
    .returning();
  await db.insert(members).values({ workspaceId: workspace.id, userId: legacySubject, role: "owner" });
  await db.insert(projectMembers).values({ projectId: project.id, userId: legacySubject, role: "editor" });

  try {
    await assert.rejects(() => bootstrapDatabaseUser({}), /AUTH_BOOTSTRAP_USERNAME/);
    assert.equal((await db.select({ id: users.id }).from(users)).length, 0);
    assert.equal(
      (await db.select({ userId: members.userId }).from(members).where(eq(members.workspaceId, workspace.id)))[0]
        ?.userId,
      legacySubject,
    );

    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${migrationFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced account migration failure'; RETURN NEW; END $$`,
      ),
    );
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${migrationTrigger} BEFORE UPDATE ON members FOR EACH ROW WHEN (OLD.user_id = '${legacySubject}') EXECUTE FUNCTION ${migrationFunction}()`,
      ),
    );
    await assert.rejects(() =>
      bootstrapDatabaseUser({
        AUTH_BOOTSTRAP_USERNAME: `rollback-${suffix}`,
        AUTH_SHARED_DEFAULT_PASSWORD: `rollback-${randomUUID()}-secret`,
        AUTH_LEGACY_USER_ID: legacySubject,
      }),
    );
    assert.equal(
      (await db.select({ id: users.id }).from(users)).length,
      0,
      "a member migration failure must roll back the new account insert",
    );
    assert.equal(
      (await db.select({ userId: members.userId }).from(members).where(eq(members.workspaceId, workspace.id)))[0]
        ?.userId,
      legacySubject,
    );
    assert.equal(
      (
        await db
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(eq(projectMembers.projectId, project.id))
      )[0]?.userId,
      legacySubject,
    );
    await db.execute(sql.raw(`DROP TRIGGER ${migrationTrigger} ON members`));
    await db.execute(sql.raw(`DROP FUNCTION ${migrationFunction}()`));

    const [firstBootstrap, secondBootstrap] = await Promise.all([
      bootstrapDatabaseUser({
        AUTH_BOOTSTRAP_USERNAME: `  Owner-${suffix}  `,
        AUTH_SHARED_DEFAULT_PASSWORD: `integration-${randomUUID()}-secret`,
        AUTH_LEGACY_USER_ID: legacySubject,
      }),
      bootstrapDatabaseUser({
        AUTH_BOOTSTRAP_USERNAME: `alternate-${suffix}`,
        AUTH_SHARED_DEFAULT_PASSWORD: `integration-${randomUUID()}-secret`,
        AUTH_LEGACY_USER_ID: legacySubject,
      }),
    ]);
    assert.deepEqual([firstBootstrap, secondBootstrap].sort(), ["already-initialized", "created"]);
    const [created] = await db.select().from(users);
    assert.ok(created);
    assert.ok([`Owner-${suffix}`, `alternate-${suffix}`].includes(created.username));
    assert.equal(created.status, "active");
    assert.equal(created.legacyAuthSubject, legacySubject);
    assert.ok(created.legacyAuthSubjectExpiresAt);
    assert.ok(created.legacyAuthSubjectExpiresAt.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000);
    assert.equal(
      (await db.select({ userId: members.userId }).from(members).where(eq(members.workspaceId, workspace.id)))[0]
        ?.userId,
      created.id,
    );
    assert.equal(
      (
        await db
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(eq(projectMembers.projectId, project.id))
      )[0]?.userId,
      created.id,
    );

    const provider = createJwtAuthProvider({ AUTH_JWT_SECRET: secret }, createDatabaseAuthAccountStore());
    assert.ok(provider);
    const oldTokenIdentity = await provider({
      headers: { authorization: `Bearer ${signedToken(legacySubject, secret)}` },
    } as never);
    assert.equal(oldTokenIdentity?.id, created.id);
    assert.equal(oldTokenIdentity?.username, created.username);

    const storedHash = created.passwordHash;

    const sharedPassword = `cli-${randomUUID()}-secret`;
    const cliEnvironment = { ...process.env, AUTH_SHARED_DEFAULT_PASSWORD: sharedPassword };
    const apiDirectory = process.cwd();
    const tsxCli = resolve(apiDirectory, "node_modules/tsx/dist/cli.mjs");
    const runCli = (...args: string[]) =>
      spawnSync(process.execPath, [tsxCli, "src/users-cli.ts", ...args], {
        cwd: apiDirectory,
        env: cliEnvironment,
        encoding: "utf8",
      });
    const createdByCli = runCli("create", `Analyst-${suffix}`);
    assert.equal(createdByCli.status, 0, createdByCli.stderr);
    const [cliUser] = await db
      .select()
      .from(users)
      .where(eq(users.usernameKey, `analyst-${suffix}`));
    assert.ok(cliUser);
    assert.equal(cliUser.status, "active");
    assert.notEqual(cliUser.passwordHash, sharedPassword);
    assert.equal(await verifyLoginPassword(sharedPassword, cliUser.passwordHash), true);
    assert.doesNotMatch(createdByCli.stdout, /passwordHash|password_hash|scrypt\$/i);
    assert.doesNotMatch(createdByCli.stdout, new RegExp(sharedPassword));

    const app = await buildApp({ environment: { APP_ENV: "test", AUTH_JWT_SECRET: secret }, logger: false });
    try {
      const migratedUserProjects = await app.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: { authorization: `Bearer ${signedToken(legacySubject, secret)}` },
      });
      assert.equal(migratedUserProjects.statusCode, 200, migratedUserProjects.body);
      const migratedUserBody = migratedUserProjects.json() as {
        workspace: { id: string };
        projects: Array<{ id: string }>;
      };
      assert.equal(migratedUserBody.workspace.id, workspace.id);
      assert.ok(migratedUserBody.projects.some((item) => item.id === project.id));

      const secondUserProjects = await app.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: { authorization: `Bearer ${signedToken(cliUser.id, secret)}` },
      });
      assert.equal(secondUserProjects.statusCode, 200, secondUserProjects.body);
      const secondUserBody = secondUserProjects.json() as {
        workspace: { id: string };
        projects: Array<{ id: string }>;
      };
      isolatedWorkspaceId = secondUserBody.workspace.id;
      assert.notEqual(isolatedWorkspaceId, workspace.id);
      assert.deepEqual(secondUserBody.projects, []);
    } finally {
      await app.close();
    }

    const duplicateByCase = runCli("create", ` analyst-${suffix.toUpperCase()} `);
    assert.equal(duplicateByCase.status, 1);

    assert.equal(runCli("disable", cliUser.id).status, 0);
    assert.equal((await db.select().from(users).where(eq(users.id, cliUser.id)))[0]?.status, "disabled");
    assert.equal(runCli("enable", cliUser.id).status, 0);
    assert.equal((await db.select().from(users).where(eq(users.id, cliUser.id)))[0]?.status, "active");
    const reset = runCli("reset-password", cliUser.id);
    assert.equal(reset.status, 0, reset.stderr);
    const [resetUser] = await db.select().from(users).where(eq(users.id, cliUser.id));
    assert.notEqual(resetUser?.passwordHash, cliUser.passwordHash);
    assert.equal(await verifyLoginPassword(sharedPassword, resetUser?.passwordHash ?? ""), true);
    assert.doesNotMatch(reset.stdout, new RegExp(sharedPassword));
    assert.doesNotMatch(reset.stdout, /scrypt\$/i);

    const repeated = await bootstrapDatabaseUser({
      AUTH_BOOTSTRAP_USERNAME: "replacement-operator",
      AUTH_SHARED_DEFAULT_PASSWORD: `replacement-${randomUUID()}-secret`,
    });
    assert.equal(repeated, "already-initialized");
    const [unchanged] = await db.select().from(users).where(eq(users.id, created.id));
    assert.equal(unchanged?.username, created.username);
    assert.equal(unchanged?.passwordHash, storedHash);
    assert.equal((await db.select({ id: users.id }).from(users)).length, 2);

    await db
      .update(users)
      .set({ legacyAuthSubjectExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(users.id, created.id));
    const expiredAlias = await provider({
      headers: { authorization: `Bearer ${signedToken(legacySubject, secret)}` },
    } as never);
    assert.equal(expiredAlias, null);
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${migrationTrigger} ON members`)).catch(() => undefined);
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${migrationFunction}()`)).catch(() => undefined);
    await db.delete(users).where(eq(users.legacyAuthSubject, legacySubject));
    await db.delete(users).where(eq(users.usernameKey, `analyst-${suffix}`));
    if (isolatedWorkspaceId) await db.delete(workspaces).where(eq(workspaces.id, isolatedWorkspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
  }
});

test.after(async () => closeDatabase());
