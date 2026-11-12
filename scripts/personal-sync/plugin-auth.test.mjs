import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { schnorr } from "@noble/curves/secp256k1.js";
import worker from "./worker.mjs";
import { createRequest } from "../../plugins/personal-lists/auth.ts";

test("temporary keys need owner proof and matching signed request bytes", async () => {
  const ownerKey = generateSecretKey();
  const viewer = getPublicKey(ownerKey);
  let current = true;
  let tamper = false;
  let badOwner = false;
  let authorizations = 0;
  const env = {
    BUZZ_OWNER: viewer,
    DB: {
      withSession: () => ({
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
        }),
      }),
    },
  };
  const host = {
    async prepareRemoteAgentAuthorization(agent) {
      authorizations++;
      const key = badOwner ? generateSecretKey() : ownerKey;
      const signature = schnorr.sign(
        createHash("sha256").update(`nostr:agent-auth:${agent}:`).digest(),
        key,
      );
      return ["auth", viewer, "", Buffer.from(signature).toString("hex")];
    },
    async request(input) {
      const response = await worker.fetch(
        new Request(input.url, { ...input, body: tamper ? "{}" : input.body }),
        env,
      );
      return { status: response.status, body: await response.text() };
    },
  };
  const make = () =>
    createRequest(
      host,
      { viewer, communityOrigin: "wss://example.org" },
      () => current,
      "https://sync.example",
    );
  const request = make();
  expect((await request({})).status).toBe(200);
  expect((await request({})).status).toBe(200);
  expect(authorizations).toBe(1);
  tamper = true;
  expect((await request({ item: { text: "Changed bytes" } })).status).toBe(401);
  tamper = false;
  badOwner = true;
  expect((await make()({})).status).toBe(401);
  current = false;
  await expect(request({})).rejects.toThrow("Account changed");
});
