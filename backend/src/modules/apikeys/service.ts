import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { ApiKeyDto, ApiKeyScope, CreatedApiKeyDto } from '@opsflow/shared';
import { db } from '../../db/client';
import { apiKeys, organizationMembers } from '../../db/schema';
import { generateApiKey, hashApiKey, keyPrefix } from '../../lib/apiKeys';
import type { RequestContext } from '../../lib/context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { auditRepository } from '../audit/repository';
import { servicesRepository } from '../services/repository';
import { apiKeysRepository as repo } from './repository';

type Row = typeof apiKeys.$inferSelect;

const toDto = (k: Row, serviceName: string | null): ApiKeyDto => ({
  id: k.id,
  name: k.name,
  keyPrefix: k.keyPrefix,
  scopes: k.scopes as ApiKeyScope[],
  serviceId: k.serviceId,
  serviceName,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
});

export const apiKeysService = {
  /**
   * Create a key. The secret is returned in this response and never again: only its SHA-256 hash is stored.
   * Each key also gets a hidden "bot" user (cannot sign in, not listed as a member) so that audit logs,
   * timeline entries and "created by" attribute actions to the key by name, with no special cases elsewhere.
   */
  async create(
    ctx: RequestContext,
    input: { name: string; scopes: ApiKeyScope[]; serviceId?: string },
  ): Promise<CreatedApiKeyDto> {
    const orgId = ctx.actor.organizationId;
    // Hash a random password so the bot account could never be signed into, even if the isBot guard were bypassed
    const unusablePassword = await argon2.hash(randomBytes(32).toString('hex'));
    const key = generateApiKey();

    const { row, serviceName } = await db.transaction(async (tx) => {
      let serviceName: string | null = null;
      if (input.serviceId) {
        const service = await servicesRepository.find(tx, orgId, input.serviceId);
        if (!service)
          throw new ValidationError(
            'Service not found in this organization',
            undefined,
            'UNKNOWN_SERVICE',
          );
        serviceName = service.name;
      }
      const bot = await repo.createBotUser(tx, {
        email: `bot-${randomUUID()}@bots.opsflow.invalid`,
        name: input.name,
        passwordHash: unusablePassword,
      });
      await tx
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: bot.id, role: 'ENGINEER' });
      const created = await repo.insert(tx, {
        organizationId: orgId,
        name: input.name,
        keyPrefix: keyPrefix(key),
        keyHash: hashApiKey(key),
        scopes: input.scopes,
        serviceId: input.serviceId ?? null,
        botUserId: bot.id,
        createdBy: ctx.actor.userId,
      });
      await auditRepository.insert(tx, ctx, {
        action: 'api_key.created',
        resourceType: 'api_key',
        resourceId: created.id,
        metadata: {
          name: input.name,
          scopes: input.scopes,
          serviceId: input.serviceId ?? null,
          keyPrefix: created.keyPrefix,
        },
      });
      return { row: created, serviceName };
    });
    return { ...toDto(row, serviceName), key };
  },

  async list(ctx: RequestContext): Promise<ApiKeyDto[]> {
    const rows = await repo.list(db, ctx.actor.organizationId);
    return rows.map((r) => toDto(r.key, r.serviceName));
  },

  async revoke(ctx: RequestContext, id: string): Promise<ApiKeyDto> {
    const orgId = ctx.actor.organizationId;
    return db.transaction(async (tx) => {
      const existing = await repo.find(tx, orgId, id);
      if (!existing) throw new NotFoundError('API key not found', 'API_KEY_NOT_FOUND');
      if (existing.key.revokedAt)
        throw new ConflictError('This API key is already revoked', 'ALREADY_REVOKED');
      const revoked = await repo.revoke(tx, orgId, id);
      if (!revoked) throw new ConflictError('This API key is already revoked', 'ALREADY_REVOKED');
      await auditRepository.insert(tx, ctx, {
        action: 'api_key.revoked',
        resourceType: 'api_key',
        resourceId: id,
        metadata: { name: revoked.name, keyPrefix: revoked.keyPrefix },
      });
      return toDto(revoked, existing.serviceName);
    });
  },
};
