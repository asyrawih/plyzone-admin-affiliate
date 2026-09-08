import { describe, expect, test } from "bun:test";
import { buildLaunchData, buildShareLink, parseLaunchData, generateReferralCode } from "./ids";
import { extractUsernameCandidates, isValidRobloxUsername } from "./username";
import { BagiBagiWebhookSchema } from "./contracts";

describe("launchData", () => {
  test("round trip", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(6);
    expect(parseLaunchData(buildLaunchData(code))).toBe(code);
  });
  test("toleran", () => {
    expect(parseLaunchData(" ref_abc123 ")).toBe("ABC123");
    expect(parseLaunchData("ref-ABC123")).toBe("ABC123");
    expect(parseLaunchData("")).toBeNull();
    expect(parseLaunchData("hello")).toBeNull();
    expect(parseLaunchData(null)).toBeNull();
  });
  test("share link", () => {
    expect(buildShareLink(123, "K7PQ2M")).toBe("https://www.roblox.com/games/start?placeId=123&launchData=ref_K7PQ2M");
  });
});

describe("username", () => {
  test("valid", () => {
    expect(isValidRobloxUsername("builderman")).toBe(true);
    expect(isValidRobloxUsername("Cool_Guy99")).toBe(true);
    expect(isValidRobloxUsername("_bad")).toBe(false);
    expect(isValidRobloxUsername("a__b")).toBe(false);
    expect(isValidRobloxUsername("ab")).toBe(false);
  });
  test("candidates prioritas", () => {
    expect(extractUsernameCandidates({ username: "explicit1", name: "Donor Name", message: "@mention1 halo un: fromMsg" }))
      .toEqual(["explicit1", "mention1", "fromMsg"]);
    expect(extractUsernameCandidates({ name: "someone", message: "" })).toEqual(["someone"]);
  });
});

describe("BagiBagiWebhookSchema", () => {
  test("normalisasi", () => {
    const r = BagiBagiWebhookSchema.parse({ transaction_id: "tx1", donator_name: "budi", amount: "Rp 50.000", message: "gas", created_at: 1725000000 });
    expect(r.externalId).toBe("tx1");
    expect(r.donorName).toBe("budi");
    expect(r.amountIdr).toBe(50000);
    expect(r.occurredAt).toBe("2024-08-30T06:40:00.000Z");
  });
  test("id wajib", () => {
    expect(() => BagiBagiWebhookSchema.parse({ amount: 1 })).toThrow();
  });
});
