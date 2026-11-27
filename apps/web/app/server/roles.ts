/** Role helpers shared by server and UI (no secrets here). */
export type Role = 'mitglied' | 'medienteam' | 'admin';

export interface GroupNames {
  mitglieder: string;
  medienteam: string;
  admin: string;
}

export function rolesFromGroups(groups: string[], names: GroupNames): Role[] {
  const clean = groups.map((g) => g.replace(/^\//, ''));
  const roles: Role[] = [];
  if (clean.includes(names.mitglieder)) roles.push('mitglied');
  if (clean.includes(names.medienteam)) roles.push('medienteam');
  if (clean.includes(names.admin)) roles.push('admin');
  return roles;
}
