import type { ChannelId } from '@postomat/core';
import {
  facebookCopyFields,
  instagramCopyFields,
  meetupCopyFields,
  type ChannelDraft,
  type CopyField,
  type Links,
  type TemplateContext,
} from '@postomat/templates';

export type { CopyField } from '@postomat/templates';

/** Copy-helper fields (one copy button each) for a copy-mode channel. */
export function copyFieldsFor(
  channel: ChannelId,
  ctx: TemplateContext,
  draft: ChannelDraft,
  links: Links,
  meetupCategory?: string | null,
): CopyField[] {
  switch (channel) {
    case 'instagram':
      return instagramCopyFields(draft);
    case 'facebook':
      return facebookCopyFields(draft, links);
    case 'meetup':
      return meetupCopyFields(ctx, draft, meetupCategory);
    default:
      return [
        { key: 'textDe', label: 'Text DE', value: draft.textDe },
        { key: 'textEn', label: 'Text EN', value: draft.textEn },
      ];
  }
}

/** Banner format used by each channel's copy helper. */
export const COPY_IMAGE_FORMAT: Record<ChannelId, '4x5' | '16x9'> = {
  instagram: '4x5',
  facebook: '4x5',
  meetup: '16x9',
  wordpress: '16x9',
  wiki: '16x9',
};
