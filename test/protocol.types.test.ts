import { describe, expect, it } from "vitest";
import { RECEIVES, type Handlers } from "../src/shared/protocol.js";

// MSP-10: handling is exhaustive by construction. These objects are checked by
// the type check, which is part of `pnpm check`: removing the expected error
// below, or adding a kind to the protocol without handling it, fails it.

const ignore = () => undefined;

export const completePage: Handlers<"page", void> = { save: ignore, navigate: ignore, flash: ignore, "open-hidden": ignore };

// @ts-expect-error a page handler table without `flash` is incomplete
export const incompletePage: Handlers<"page", void> = { save: ignore, navigate: ignore, "open-hidden": ignore };

// @ts-expect-error a panel handler table without `hidden-changed` is incomplete
export const incompletePanel: Handlers<"panel", void> = {
  "selection-opened": ignore,
  "values-loaded": ignore,
  "usage-loaded": ignore,
  "config-loaded": ignore,
};

describe("protocol handler tables", () => {
  it("a complete page table handles every kind the page receives", () => {
    expect(Object.keys(completePage).sort()).toEqual([...RECEIVES.page].sort());
  });
});
