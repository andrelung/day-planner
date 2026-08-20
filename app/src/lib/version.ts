/// __APP_VERSION__ comes from app/package.json's "version" field (see
/// vite.config.ts's `define`) — bump that field to cut a new release.
/// VITE_GIT_COMMIT/VITE_GIT_DIRTY are baked in at Docker build time from
/// the host's actual git state (see Dockerfile + docker-compose.yml) —
/// 'dev' when running `npm run dev` directly, where there's no build step
/// to inject them.
export const APP_VERSION = __APP_VERSION__;
const gitCommit = import.meta.env.VITE_GIT_COMMIT || 'dev';
const gitDirty = import.meta.env.VITE_GIT_DIRTY === '1' ? '-dirty' : '';

export const VERSION_LABEL = `v${APP_VERSION} - commit ${gitCommit}${gitDirty}`;
