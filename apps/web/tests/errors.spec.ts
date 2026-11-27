import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '@postomat/core';
import { actionError } from '../app/server/errors';

describe('actionError', () => {
  it('explains invalid status changes in German', () => {
    expect(
      actionError(new InvalidTransitionError('geplant', 'verworfen')),
    ).toBe('Das geht im Status „Geplant“ nicht (nicht möglich: Verworfen).');
  });
  it('passes other messages through', () => {
    expect(actionError(new Error('Bitte eine Frage eingeben.'))).toBe(
      'Bitte eine Frage eingeben.',
    );
  });
});
