// Test/compile preload only. Fails closed before any external socket/request.
const deny = () => { throw new Error("PIKI_OFFLINE_NETWORK_BLOCKED"); };
for (const name of ["http", "https"]) {
  const transport = require(`node:${name}`);
  transport.request = deny;
  transport.get = deny;
}
const net = require("node:net");
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
net.Server.prototype.listen = deny;
const dgram = require("node:dgram");
dgram.Socket.prototype.send = deny;
dgram.Socket.prototype.bind = deny;
const tls = require("node:tls");
tls.connect = deny;
const dns = require("node:dns");
dns.lookup = deny;
dns.resolve = deny;
dns.promises.lookup = deny;
dns.promises.resolve = deny;
globalThis.fetch = deny;
require("node:module").syncBuiltinESMExports();
