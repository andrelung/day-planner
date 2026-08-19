import type { CookieOptions, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

const isProd = process.env.NODE_ENV === 'production';

const SESSION_COOKIE = 'dp_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const baseCookieOpts: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
};

export interface SessionPayload {
  sub: string; // User.id
}

export function setSessionCookie(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId } satisfies SessionPayload, env.SESSION_JWT_SECRET, {
    expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
  res.cookie(SESSION_COOKIE, token, { ...baseCookieOpts, maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, baseCookieOpts);
}

function readUserId(req: Request): string | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.SESSION_JWT_SECRET) as SessionPayload;
    return payload.sub;
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/// Attaches req.userId when a valid session cookie is present; does not reject.
export function attachSession(req: Request, _res: Response, next: NextFunction) {
  const userId = readUserId(req);
  if (userId) req.userId = userId;
  next();
}

/// Rejects the request with 401 unless a valid session is present.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  next();
}

// --- OAuth CSRF state ---
// The state value is a signed, short-lived JWT that also carries the
// callback's "intent" (fresh login vs. connecting a secondary provider onto
// an already-signed-in user). It is set as a cookie AND passed as the OAuth
// `state` query param; the callback route accepts only when both match,
// which defeats both CSRF (an attacker can't forge the cookie) and tampering
// (the JWT signature covers the intent payload).

const OAUTH_STATE_COOKIE = 'dp_oauth_state';

export interface OAuthStatePayload {
  nonce: string;
  /// Present when connecting a secondary provider onto an existing session;
  /// absent for a fresh login (a new User is created on callback).
  linkUserId?: string;
}

export function beginOAuthState(res: Response, payload: Omit<OAuthStatePayload, 'nonce'>): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const token = jwt.sign({ ...payload, nonce } satisfies OAuthStatePayload, env.SESSION_JWT_SECRET, {
    expiresIn: '10m',
  });
  res.cookie(OAUTH_STATE_COOKIE, token, { ...baseCookieOpts, maxAge: 10 * 60 * 1000 });
  return token;
}

/// Verifies the returned `state` matches the cookie set at the start of the
/// flow and is a validly signed, unexpired token. Clears the cookie either way.
export function consumeOAuthState(req: Request, res: Response, returnedState: string | undefined): OAuthStatePayload | null {
  const cookieToken = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, baseCookieOpts);
  if (!cookieToken || !returnedState || cookieToken !== returnedState) return null;
  try {
    return jwt.verify(cookieToken, env.SESSION_JWT_SECRET) as OAuthStatePayload;
  } catch {
    return null;
  }
}
