import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const schema = z.object({ pendingCreditId: z.string().min(1).nullable() });
export type RecoveryState = z.infer<typeof schema>;

export const loadRecoveryState = async (path: string): Promise<RecoveryState> => {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pendingCreditId: null };
    throw error; // A corrupt checkpoint must not silently permit another redemption.
  }
};

export const saveRecoveryState = async (path: string, state: RecoveryState): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
};
