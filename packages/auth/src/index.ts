import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const AudienceSchema = z.enum(['web', 'studio', 'portal', 'worker', 'service']);
export type Audience = z.infer<typeof AudienceSchema>;

export const JwtClaimsSchema = z.object({
  sub: z.string().uuid().or(z.string().min(1)),
  tenant_id: z.string().uuid().or(z.literal('')).nullable(),
  user_id: z.string().uuid().or(z.literal('')).nullable(),
  aud: AudienceSchema,
  roles: z.array(z.string()),
  capabilities: z.array(z.string())
});

export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export interface SignJwtInput {
  claims: JwtClaims;
  secret: string;
  expiresIn?: jwt.SignOptions['expiresIn'];
}

export const signJwt = ({ claims, secret, expiresIn = '8h' }: SignJwtInput): string => {
  return jwt.sign(claims, secret, { expiresIn });
};

export const verifyJwt = (token: string, secret: string): JwtClaims => {
  const decoded = jwt.verify(token, secret);
  return JwtClaimsSchema.parse(decoded);
};

export const parseBearerToken = (authHeader?: string): string | null => {
  if (!authHeader) {
    return null;
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
};
