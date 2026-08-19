import { prisma } from './prisma.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { refreshAsanaToken } from '../providers/asana.js';
import { refreshOutlookToken } from '../providers/outlook.js';
import type { Provider } from '../generated/prisma/enums.js';

export class ProviderNotConnectedError extends Error {
  constructor(public provider: Provider) {
    super(`${provider} is not connected for this user`);
  }
}

/// Returns a valid (refreshed if necessary) access token for the given user
/// + provider, persisting a refreshed token back to the DB.
export async function getValidAccessToken(userId: string, provider: Provider): Promise<string> {
  const account = await prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId, provider } } });
  if (!account) throw new ProviderNotConnectedError(provider);

  const expiringSoon = account.expiresAt ? account.expiresAt.getTime() - Date.now() < 60_000 : false;
  if (!expiringSoon) {
    return decryptSecret(account.accessTokenEnc);
  }
  if (!account.refreshTokenEnc) {
    // No refresh token to fall back on — hand back the (possibly stale)
    // access token and let the API call itself fail with a clear 401.
    return decryptSecret(account.accessTokenEnc);
  }

  const refreshToken = decryptSecret(account.refreshTokenEnc);
  const fresh = provider === 'ASANA' ? await refreshAsanaToken(refreshToken) : await refreshOutlookToken(refreshToken);

  await prisma.oAuthAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: encryptSecret(fresh.accessToken),
      refreshTokenEnc: fresh.refreshToken ? encryptSecret(fresh.refreshToken) : account.refreshTokenEnc,
      expiresAt: fresh.expiresAt,
    },
  });

  return fresh.accessToken;
}
