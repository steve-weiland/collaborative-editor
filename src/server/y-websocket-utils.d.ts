// y-websocket@1.5 ships its server-side helper as a CommonJS file at
// `bin/utils.js` without bundled type declarations. We import it
// dynamically and treat its exports as opaque; this declaration silences
// the missing-types error.
declare module 'y-websocket/bin/utils';
