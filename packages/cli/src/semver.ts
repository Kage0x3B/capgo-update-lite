/**
 * The CLI's semver primitives now live in `capgo-update-lite-shared` so the
 * server and CLI agree on what counts as a valid native-app version. This file
 * is kept as a thin re-export so existing import paths inside the CLI keep
 * working.
 */
export { compareSemver as cmpSemver, parseSemver, type Semver } from 'capgo-update-lite-shared/semver';
