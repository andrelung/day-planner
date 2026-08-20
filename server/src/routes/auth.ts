import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { encryptSecret } from '../lib/crypto.js';
import { beginOAuthState, clearSessionCookie, consumeOAuthState, requireAuth, setSessionCookie } from '../lib/auth.js';
import { env } from '../lib/env.js';
import { exchangeAsanaCode, getAsanaAuthorizeUrl, ProviderNotConfiguredError } from '../providers/asana.js';
import { exchangeOutlookCode, getOutlookAuthorizeUrl } from '../providers/outlook.js';
import type { Provider as DbProvider } from '../generated/prisma/enums.js';

export const authRouter = Router();

type ProviderParam = 'asana' | 'outlook';

function toDbProvider(p: ProviderParam): DbProvider {
  return p === 'asana' ? 'ASANA' : 'OUTLOOK';
}

function isProviderParam(p: string): p is ProviderParam {
  return p === 'asana' || p === 'outlook';
}

authRouter.get('/:provider/start', (req, res) => {
  const { provider } = req.params;
  if (!isProviderParam(provider)) {
    res.status(404).json({ error: 'Unknown provider' });
    return;
  }
  try {
    const state = beginOAuthState(res, { linkUserId: req.userId });
    const url = provider === 'asana' ? getAsanaAuthorizeUrl(state) : getOutlookAuthorizeUrl(state);
    res.redirect(url);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      res.status(503).send(
        `${err.provider === 'asana' ? 'Asana' : 'Outlook'} OAuth isn't configured on this server yet. ` +
          `An operator needs to set the ${err.provider === 'asana' ? 'ASANA_CLIENT_ID / ASANA_CLIENT_SECRET' : 'MS_CLIENT_ID / MS_CLIENT_SECRET'} ` +
          `environment variables — see the README for how to register the OAuth app.`,
      );
      return;
    }
    throw err;
  }
});

authRouter.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  if (!isProviderParam(provider)) {
    res.status(404).json({ error: 'Unknown provider' });
    return;
  }

  const returnedState = typeof req.query.state === 'string' ? req.query.state : undefined;
  const statePayload = consumeOAuthState(req, res, returnedState);
  if (!statePayload) {
    res.status(400).send('This sign-in link expired or is invalid. Please try connecting again.');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!code) {
    res.status(400).send(`${provider} did not return an authorization code.`);
    return;
  }

  const dbProvider = toDbProvider(provider);
  const { tokens, accountLabel, externalAccountId } =
    provider === 'asana' ? await exchangeAsanaCode(code) : await exchangeOutlookCode(code);

  const accountData = {
    externalAccountId,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    accountLabel,
  };

  if (statePayload.linkUserId) {
    // Connecting a secondary (or reconnecting an existing) provider onto the
    // already-signed-in user from this session.
    await prisma.oAuthAccount.upsert({
      where: { userId_provider: { userId: statePayload.linkUserId, provider: dbProvider } },
      create: { userId: statePayload.linkUserId, provider: dbProvider, ...accountData },
      update: accountData,
    });
    res.redirect(env.PUBLIC_APP_URL);
    return;
  }

  // Fresh login: recognize a returning user by (provider, externalAccountId);
  // otherwise this is a brand-new user and this provider becomes primary.
  const existing = await prisma.oAuthAccount.findUnique({
    where: { provider_externalAccountId: { provider: dbProvider, externalAccountId } },
  });

  let userId: string;
  let isNewUser = false;
  if (existing) {
    userId = existing.userId;
    await prisma.oAuthAccount.update({ where: { id: existing.id }, data: accountData });
  } else {
    const user = await prisma.user.create({
      data: {
        primaryProvider: dbProvider,
        settings: { create: {} },
        accounts: { create: { provider: dbProvider, ...accountData } },
      },
    });
    userId = user.id;
    isNewUser = true;
  }

  setSessionCookie(res, userId);
  // A brand-new user still needs to connect (or explicitly skip) their
  // secondary provider — the frontend reads this to show that step once.
  res.redirect(isNewUser ? `${env.PUBLIC_APP_URL}/?onboarding=secondary` : env.PUBLIC_APP_URL);
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

/// Disconnects one provider's account. If it's the only one connected,
/// there's nothing useful left to do in the app, so this also signs the
/// user out entirely (same as /logout) rather than leaving them on a
/// broken, provider-less session. If it's the primary provider but the
/// other one is still connected, primaryProvider (a required field —
/// schema.prisma) gets reassigned to whichever's left rather than leaving
/// it dangling. Reconnecting afterward is always safe either way — the
/// OAuth callback above upserts on (userId, provider).
authRouter.delete('/:provider', requireAuth, async (req, res) => {
  const provider = req.params.provider;
  if (typeof provider !== 'string' || !isProviderParam(provider)) {
    res.status(404).json({ error: 'Unknown provider' });
    return;
  }
  const dbProvider = toDbProvider(provider);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, include: { accounts: true } });
  const account = user.accounts.find((a) => a.provider === dbProvider);
  if (!account) {
    res.status(404).json({ error: 'Not connected' });
    return;
  }
  const remaining = user.accounts.filter((a) => a.provider !== dbProvider);

  await prisma.oAuthAccount.delete({ where: { id: account.id } });

  if (remaining.length === 0) {
    clearSessionCookie(res);
    res.json({ loggedOut: true });
    return;
  }
  if (user.primaryProvider === dbProvider) {
    await prisma.user.update({ where: { id: user.id }, data: { primaryProvider: remaining[0].provider } });
  }
  res.json({ loggedOut: false, primaryProvider: user.primaryProvider === dbProvider ? remaining[0].provider : user.primaryProvider });
});
