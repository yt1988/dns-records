// The only file that knows about Cloudflare's sockets API. Worker-only, imported lazily from the /whois handler: a
// socket can only be opened while a request is being handled, never at module scope, and the Node tests import the
// Worker directly, where "cloudflare:sockets" does not exist.
import { connect } from "cloudflare:sockets";

export const connectTo = (host, port) => connect({ hostname: host, port });
