export type DbRole = 'zen_web' | 'zen_studio' | 'zen_portal' | 'zen_worker';
export type Audience = 'web' | 'studio' | 'portal' | 'worker' | 'service';

export const roleForAudience = (aud: Audience): DbRole => {
  if (aud === 'studio') return 'zen_studio';
  if (aud === 'portal') return 'zen_portal';
  if (aud === 'worker' || aud === 'service') return 'zen_worker';
  return 'zen_web';
};
