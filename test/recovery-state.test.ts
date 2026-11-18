import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadRecoveryState, saveRecoveryState } from "../src/recovery-state.ts";

it("persists a pending redemption and refuses corrupt state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reset-state-test-"));
  const path = join(dir, "state.json");
  try {
    expect(await loadRecoveryState(path)).toEqual({ pendingCreditId: null });
    await saveRecoveryState(path, { pendingCreditId: "credit-1" });
    expect(await loadRecoveryState(path)).toEqual({ pendingCreditId: "credit-1" });
    await saveRecoveryState(path, { pendingCreditId: null });
    expect(await loadRecoveryState(path)).toEqual({ pendingCreditId: null });
    await writeFile(path, "broken");
    await expect(loadRecoveryState(path)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
