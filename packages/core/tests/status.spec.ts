import { describe, expect, it } from 'vitest';
import {
  autoChannelsSettled,
  memberStage,
  overallStatusAfterApproval,
  STATUS_LABELS,
  WEB_STATUS_LABELS,
} from '../src/status.ts';
import { productionSecretProblems, loadEnv } from '../src/env.ts';
import type { ChannelPostStatus, PostStatus } from '../src/types.ts';

describe('memberStage', () => {
  it.each<[PostStatus, number, number, string]>([
    ['sammeln', 0, -1, 'Entwurf'],
    ['zur_freigabe', 1, 1, 'Beim Medienteam'],
    ['aenderung_gewuenscht', 1, 1, 'Beim Medienteam'],
    ['geplant', 2, 2, 'Geplant'],
    ['online', 4, -1, 'Online'],
    ['verworfen', 0, -1, 'Verworfen'],
  ])('%s → %d done, current %d, %s', (status, done, current, label) => {
    const s = memberStage(status);
    expect(s).toMatchObject({ done, current, label });
    expect(s.draft).toBe(status === 'sammeln');
    expect(s.discarded).toBe(status === 'verworfen');
  });
});

describe('overallStatusAfterApproval', () => {
  const ch = (...s: ChannelPostStatus[]) => s.map((status) => ({ status }));
  it.each<[ChannelPostStatus[], 'geplant' | 'online']>([
    [
      [
        'veroeffentlicht',
        'veroeffentlicht',
        'erledigt',
        'erledigt',
        'erledigt',
      ],
      'online',
    ],
    [['veroeffentlicht', 'uebersprungen', 'aus'], 'online'],
    [['veroeffentlicht', 'kopieren'], 'geplant'],
    [['wartet', 'erledigt'], 'geplant'],
    [['fehler', 'erledigt'], 'geplant'],
    [['entwurf'], 'geplant'],
    [[], 'online'],
  ])('%j → %s', (statuses, expected) => {
    expect(overallStatusAfterApproval(ch(...statuses))).toBe(expected);
  });

  it('autoChannelsSettled ignores copy channels and waits for wartet', () => {
    expect(
      autoChannelsSettled([
        { mode: 'auto', status: 'veroeffentlicht' },
        { mode: 'auto', status: 'fehler' },
        { mode: 'copy', status: 'kopieren' },
      ]),
    ).toBe(true);
    expect(autoChannelsSettled([{ mode: 'auto', status: 'wartet' }])).toBe(
      false,
    );
  });
});

describe('labels', () => {
  it('web says "Geplant", the card keeps "Freigegeben"', () => {
    expect(WEB_STATUS_LABELS.geplant).toBe('Geplant');
    expect(STATUS_LABELS.geplant).toBe('Freigegeben');
  });
});

describe('productionSecretProblems', () => {
  it('is quiet outside production', () => {
    expect(productionSecretProblems(loadEnv({}))).toEqual([]);
  });
  it('flags dev secrets in production', () => {
    expect(
      productionSecretProblems(
        loadEnv({
          NODE_ENV: 'production',
          OIDC_CLIENT_SECRET: 'postomat-dev-secret',
        }),
      ),
    ).toHaveLength(2);
    expect(
      productionSecretProblems(
        loadEnv({
          NODE_ENV: 'production',
          SESSION_SECRET: 'x'.repeat(40),
          OIDC_CLIENT_SECRET: 'real',
        }),
      ),
    ).toEqual([]);
  });
});
