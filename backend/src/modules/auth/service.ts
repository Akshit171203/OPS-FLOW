import argon2 from 'argon2';
import type { LoginInput, RegisterInput } from '@opsflow/shared';
import { db } from '../../db/client';
import { ConflictError, UnauthorizedError } from '../../lib/errors';
import { authRepository as repo } from './repository';

// Verified against when the email is unknown so both failure paths cost the same.
const dummyHashPromise = argon2.hash('opsflow-dummy-password');

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const authService = {
  async register(input: RegisterInput) {
    const email = normalizeEmail(input.email);
    const passwordHash = await argon2.hash(input.password);
    try {
      return await db.transaction(async (tx) => {
        const user = await repo.insertUser(tx, { email, passwordHash, name: input.name });
        const org = await repo.insertOrganization(tx, input.organizationName);
        await repo.insertMember(tx, { organizationId: org.id, userId: user.id, role: 'OWNER' });
        return { userId: user.id, organizationId: org.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          'An account with this email already exists',
          'EMAIL_ALREADY_REGISTERED',
        );
      }
      throw err;
    }
  },

  async login(input: LoginInput) {
    const user = await repo.findUserByEmail(db, normalizeEmail(input.email));
    const hash = user?.passwordHash ?? (await dummyHashPromise);
    const valid = await argon2.verify(hash, input.password);
    if (!user || !valid) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    const membership = await repo.findFirstMembership(db, user.id);
    if (!membership)
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    return { userId: user.id, organizationId: membership.organizationId };
  },
};
