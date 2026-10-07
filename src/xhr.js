/**
 * grpc-web's client is built on XMLHttpRequest, which Node does not provide.
 * Install the xhr2 polyfill before the first call.
 */
import XHR from 'xhr2';

export function installXhr() {
  if (!globalThis.XMLHttpRequest) {
    globalThis.XMLHttpRequest = XHR;
  }
}
