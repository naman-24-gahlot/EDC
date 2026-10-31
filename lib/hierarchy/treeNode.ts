// SERVER-ONLY. One row of the hierarchy page (app/admin/hierarchy) — the same shape whether the
// page renders it or a branch is fetched when opened (/api/admin/hierarchy).
if (typeof window !== 'undefined') {
  throw new Error('lib/hierarchy/treeNode.ts must never be imported into client code.');
}

import { accessCodeFor } from '@/lib/access/codes';
import { PROFILE_LABEL } from '@/lib/display';
import type { PersonRecord } from '@/lib/hierarchy/authorize';

export interface TreeNode {
  personId: string;
  name: string;
  username: string;
  /** "Master · Employee · EMP00012 · PENDING" etc. */
  meta: string;
  /** Employees and Masters can have people under them: their row can be opened. */
  canHaveKids: boolean;
}

export function treeNode(p: PersonRecord): TreeNode {
  const code = accessCodeFor(p.profileType, p.accessNumber);
  return {
    personId: p.personId,
    name: `${p.firstName} ${p.lastName}`,
    username: p.username,
    meta: `${p.systemRole === 'master' ? 'Master · ' : ''}${p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard'}${code ? ` · ${code}` : ''}`
      + (p.registrationStatus !== 'APPROVED' ? ` · ${p.registrationStatus}` : !p.active ? ' · deactivated' : ''),
    canHaveKids: p.systemRole === 'master' || p.profileType === 'employee',
  };
}

export const byName = (a: PersonRecord, b: PersonRecord) => a.firstName.localeCompare(b.firstName);

/** A node with its people under it already filled in (the "show everyone" view). */
export interface TreeBranch { node: TreeNode; kids?: TreeBranch[] }
