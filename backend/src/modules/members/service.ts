import type { MemberDto, Role } from '@opsflow/shared';
import { db } from '../../db/client';
import type { AuthContext } from '../../middleware/auth';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { membersRepository as repo } from './repository';

function assertCanGrant(actor: AuthContext, role: Role) {
  if (role === 'OWNER' && actor.role !== 'OWNER') {
    throw new ForbiddenError('Only an OWNER can grant the OWNER role');
  }
}

async function toDto(organizationId: string, id: string): Promise<MemberDto> {
  const rows = await repo.listByOrg(db, organizationId);
  return rows.find((r) => r.id === id)!;
}

export const membersService = {
  list(actor: AuthContext): Promise<MemberDto[]> {
    return repo.listByOrg(db, actor.organizationId);
  },

  async add(actor: AuthContext, input: { email: string; role: Role }) {
    assertCanGrant(actor, input.role);
    const user = await repo.findUserByEmail(db, input.email.trim().toLowerCase());
    if (!user) throw new NotFoundError('No user with that email', 'USER_NOT_FOUND');
    const existing = await repo.findMemberByUser(db, actor.organizationId, user.id);
    if (existing) throw new ConflictError('User is already a member', 'ALREADY_MEMBER');
    const member = await repo.insert(db, {
      organizationId: actor.organizationId,
      userId: user.id,
      role: input.role,
    });
    return toDto(actor.organizationId, member.id);
  },

  async changeRole(actor: AuthContext, memberId: string, role: Role) {
    const target = await repo.findMember(db, actor.organizationId, memberId);
    if (!target) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
    if (target.role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenError('An OWNER cannot be modified by an ADMIN');
    }
    assertCanGrant(actor, role);
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await repo.countOwners(db, actor.organizationId);
      if (owners <= 1) {
        throw new ConflictError('An organization must keep at least one OWNER', 'LAST_OWNER');
      }
    }
    await repo.updateRole(db, actor.organizationId, memberId, role);
    return toDto(actor.organizationId, memberId);
  },
};
