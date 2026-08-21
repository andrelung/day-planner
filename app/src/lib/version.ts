/// __APP_VERSION__ comes from app/package.json's "version" field (see
/// vite.config.ts's `define`) — bump that field to cut a new release.
/// VITE_GIT_COMMIT/VITE_GIT_DIRTY are baked in at Docker build time from
/// the host's actual git state (see Dockerfile + docker-compose.yml) —
/// 'dev' when running `npm run dev` directly, where there's no build step
/// to inject them.
export const APP_VERSION = __APP_VERSION__;
/// Exported (not just folded into VERSION_LABEL) so the store can compare
/// it against /api/version's live commit and detect a stale, long-open
/// session — see checkForUpdate.
export const GIT_COMMIT = import.meta.env.VITE_GIT_COMMIT || 'dev';
const gitDirty = import.meta.env.VITE_GIT_DIRTY === '1' ? '-dirty' : '';
/// Unique per rebuild.sh invocation regardless of git state — the actual
/// key checkForUpdate compares, not GIT_COMMIT: a long stretch of
/// uncommitted rebuilds (the normal case while iterating on a feature) all
/// share one commit hash, so GIT_COMMIT alone could never tell a client
/// running an hour-old rebuild apart from one running the latest.
export const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'dev';

export const VERSION_LABEL = `v${APP_VERSION} - commit ${GIT_COMMIT}${gitDirty}`;
