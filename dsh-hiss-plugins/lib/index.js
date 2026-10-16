/**
 * The bundle's carrier row: no host behaviour of its own.
 *
 * It exists because the client module system only serves a package's browser half
 * (`lib/client.js`) when that package holds a Loader row — the management tab in the
 * Plugins page arrives through this row and nothing else. The four features live in
 * their own top-level rows, so switching one of them never removes this seat.
 *
 * @module dsh-hiss-plugins
 */
export const name = "dsh-hiss-plugins";
export const inject = [];
export function apply() {}
