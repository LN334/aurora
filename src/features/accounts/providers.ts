/**
 * Account provider ids.
 *
 * Aurora deliberately separates two things people lump together as "login":
 *
 *  1. Identity on this machine - local profiles.
 *  2. A remote service account - only ever through an interface the service
 *     itself publishes for third parties.
 *
 * This module owns the vocabulary only. Which providers can be signed in, and
 * what each one needs, lives with that provider's own client under `electron/`
 * and in `accounts/store.ts`. Keeping it next to the code that talks to the
 * service stops a central table from drifting out of date.
 */

export type ProviderId =
  | 'local'
  | 'subsonic'
  | 'lastfm'
  | 'listenbrainz'
  | 'spotify'
  | 'apple'
  | 'netease'
  | 'qq'
