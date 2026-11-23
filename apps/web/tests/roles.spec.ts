import { describe, expect, it } from 'vitest';
import { rolesFromGroups } from '../app/server/roles';

const names = {
  mitglieder: 'mitglieder',
  medienteam: 'medienteam',
  admin: 'postomat-admin',
};

describe('rolesFromGroups', () => {
  it('maps Keycloak groups to roles (with or without leading slash)', () => {
    expect(rolesFromGroups(['mitglieder', '/medienteam'], names)).toEqual([
      'mitglied',
      'medienteam',
    ]);
    expect(rolesFromGroups(['postomat-admin'], names)).toEqual(['admin']);
  });

  it('gives no role for users without any Postomat group ("Kein Zugang")', () => {
    expect(rolesFromGroups([], names)).toEqual([]);
    expect(rolesFromGroups(['andere-gruppe'], names)).toEqual([]);
  });

  it('respects configured group names', () => {
    expect(
      rolesFromGroups(['team-media'], { ...names, medienteam: 'team-media' }),
    ).toEqual(['medienteam']);
  });
});
