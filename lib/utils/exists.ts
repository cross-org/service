import { stat } from "node:fs/promises"

export async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === "ENOENT") {
      return false
    } else {
      // Unexpected error, re-throw for the caller to handle it
      throw error
    }
  }
}
