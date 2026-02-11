import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const REQUIRED_AUDIENCE_KEY = 'requiredAudience';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const RequireAudience = (aud: 'web' | 'studio' | 'portal' | 'worker' | 'service') =>
  SetMetadata(REQUIRED_AUDIENCE_KEY, aud);
