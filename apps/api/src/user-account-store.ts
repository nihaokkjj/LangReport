import {
  findUserAccountById,
  findUserAccountByLegacySubject,
  findUserAccountByUsernameKey,
  updateUserAccountPasswordHash,
  type UserAccountRecord,
} from "@langreport/db";

export type { UserAccountRecord } from "@langreport/db";

export type AuthAccountStore = {
  findByUsernameKey(usernameKey: string): Promise<UserAccountRecord | undefined>;
  findById(id: string): Promise<UserAccountRecord | undefined>;
  findByLegacySubject(subject: string): Promise<UserAccountRecord | undefined>;
  updatePasswordHash(id: string, passwordHash: string, changedAt: Date): Promise<boolean>;
};

export function createDatabaseAuthAccountStore(): AuthAccountStore {
  return {
    findByUsernameKey: findUserAccountByUsernameKey,
    findById: findUserAccountById,
    findByLegacySubject: findUserAccountByLegacySubject,
    updatePasswordHash: updateUserAccountPasswordHash,
  };
}
