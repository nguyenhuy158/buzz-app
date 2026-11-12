import type { Host, NipOaAuthorization } from "../../src/features/host/service";
import type { PersonalItem } from "../../src/bundled/personal-lists/model";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

export function createRequest(
  host: Host,
  scope: { viewer: string; communityOrigin: string },
  isCurrent: () => boolean,
  endpoint: string,
) {
  let key: Uint8Array | undefined;
  let proof: NipOaAuthorization | undefined;
  return async ({ cursor, item }: { cursor?: string; item?: PersonalItem }) => {
    if (!isCurrent()) throw new Error("Account changed. Open this list again.");
    if (!host.prepareRemoteAgentAuthorization)
      throw new Error("Update Buzz to use Personal Lists sync.");
    if (!key) key = generateSecretKey();
    if (!proof)
      proof = await host.prepareRemoteAgentAuthorization(getPublicKey(key));
    if (proof[1] !== scope.viewer || !isCurrent())
      throw new Error("Account changed. Open this list again.");
    const url = new URL("/items", endpoint);
    url.searchParams.set("community", scope.communityOrigin);
    if (cursor) url.searchParams.set("cursor", cursor);
    const method = item ? "POST" : "GET";
    const body = item ? JSON.stringify(item) : "";
    const tags = [["u", url.href], ["method", method], [...proof]];
    if (item) {
      const hash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      );
      tags.push([
        "payload",
        Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ]);
    }
    if (!isCurrent()) throw new Error("Account changed. Open this list again.");
    const event = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "",
      },
      key,
    );
    const response = await host.request({
      url: url.href,
      method,
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(event))}`,
        "Content-Type": "application/json",
      },
      ...(item ? { body } : {}),
    });
    if (!isCurrent()) throw new Error("Account changed. Open this list again.");
    return { status: response.status, body: JSON.parse(response.body) };
  };
}
