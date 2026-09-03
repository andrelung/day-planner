/// A non-OK response from a provider's own API (Asana / Microsoft Graph),
/// carried intact as far as index.ts's error handler so the user is told
/// what actually went wrong. These used to be plain `Error`s, which the
/// handler could only turn into a blanket 500 "Internal server error" —
/// confirmed live on the one case that matters most in practice: adding a
/// task to an Asana project the account has no write access to, where the
/// app said "Internal server error" and left no clue that the fix is a
/// permission, not a bug.
///
/// The provider's *own* message is deliberately included in the user-facing
/// text rather than kept to the server log — Asana's are specific and
/// actionable ("project: Not a recognized ID", "user not authorized to
/// access project"), and a generic paraphrase would throw away the only
/// part that says which project or field it objected to.
export class ProviderApiError extends Error {
  constructor(
    readonly provider: 'Asana' | 'Outlook',
    readonly status: number,
    readonly path: string,
    /// The provider's own message, extracted from its error body — null if
    /// the body wasn't in the shape we know, or was empty.
    readonly providerMessage: string | null,
    /// The untouched response body, for the server-side log only.
    readonly rawBody: string,
  ) {
    super(`${provider} API ${path} failed: ${status} ${rawBody}`);
    this.name = 'ProviderApiError';
  }

  /// What this app answers its own client with. Provider 4xx values that
  /// describe the *request* pass through unchanged (403/404/429 all mean
  /// the same thing one layer down); everything else becomes 502, since a
  /// provider being broken or refusing our credentials is an upstream
  /// failure and not something the caller got wrong. Notably a provider
  /// 401 is never passed through as a 401 — that status means "your
  /// session with *this* app expired" to the client (see store.svelte.ts's
  /// boot), which is a different thing entirely from Asana rejecting a
  /// token we hold on the user's behalf.
  get httpStatus(): number {
    if (this.status === 403 || this.status === 404 || this.status === 429) return this.status;
    if (this.status === 400 || this.status === 402) return this.status;
    return 502;
  }

  get userMessage(): string {
    const detail = this.providerMessage ? ` ${this.providerMessage}` : '';
    switch (this.status) {
      case 400:
        return `${this.provider} rejected this request.${detail}`;
      case 401:
        return `Your ${this.provider} connection is no longer authorized — reconnect ${this.provider} in Settings.${detail}`;
      case 402:
        return `${this.provider} says this needs a paid plan.${detail}`;
      case 403:
        return this.provider === 'Asana'
          ? `You don't have permission to do this in Asana.${detail} If it's a project you're adding to, you need edit access to it — ask its owner, or pick a different project.`
          : `You don't have permission to do this in Outlook.${detail}`;
      case 404:
        return `${this.provider} can't find that any more — it may have been deleted, or your account can't see it.${detail}`;
      case 429:
        return `${this.provider} is rate-limiting us right now. Wait a moment and try again.`;
      default:
        if (this.status >= 500) return `${this.provider} is having trouble right now (${this.status}). Try again in a moment.`;
        return `${this.provider} refused this request (${this.status}).${detail}`;
    }
  }
}

/// Pulls the human-readable part out of a provider error body. Asana sends
/// `{"errors":[{"message":"...","help":"..."}]}`, Graph sends
/// `{"error":{"code":"...","message":"..."}}` — anything else (an HTML
/// error page from a proxy, an empty body) yields null rather than
/// spilling markup into a toast.
export function parseProviderMessage(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const asana = (parsed as { errors?: { message?: unknown }[] })?.errors;
  if (Array.isArray(asana)) {
    const messages = asana.map((e) => e?.message).filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (messages.length) return clamp(messages.join(' · '));
  }
  const graph = (parsed as { error?: { message?: unknown } })?.error;
  if (graph && typeof graph.message === 'string' && graph.message.length) return clamp(graph.message);
  return null;
}

/// Long enough for any real provider message, short enough that a toast
/// stays a toast if one ever comes back with a stack trace in it.
function clamp(s: string): string {
  const trimmed = s.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 299)}…` : trimmed;
}
