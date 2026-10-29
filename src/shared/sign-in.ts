import { isHelpText, readSignInDescriptor, type SignInDescriptor } from "@intl-tms/core/tools";
import { SIGN_IN } from "./strings.js";

/**
 * Whether the website lets the Editor in, as the Page Host last heard it: set
 * by a refused answer and cleared by the next accepted one. The Extension
 * holds no credential; this is only what the website said.
 */
export type SignInStatus =
  | { state: "accepted"; /** Who the website says the Editor is. Shown only, never stored durably. */ editor?: string }
  | { state: "not-signed-in"; descriptor?: SignInDescriptor }
  | { state: "not-permitted" };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A sign-in status from storage or a message, validated: the descriptor as
 * the Core reads it, and a name only when it is one short line
 * of text. Anything else is no status.
 */
export function readSignInStatus(value: unknown): SignInStatus | undefined {
  if (!isObject(value)) return undefined;
  if (value.state === "accepted") return isHelpText(value.editor) ? { state: "accepted", editor: value.editor } : { state: "accepted" };
  if (value.state === "not-signed-in") {
    const descriptor = readSignInDescriptor({ auth: value.descriptor });
    return descriptor === undefined ? { state: "not-signed-in" } : { state: "not-signed-in", descriptor };
  }
  if (value.state === "not-permitted") return { state: "not-permitted" };
  return undefined;
}

/** "Editing as <name>", when the website named the Editor. */
export function editingAs(status: SignInStatus | undefined): string | undefined {
  return status?.state === "accepted" && status.editor !== undefined ? SIGN_IN.editingAs(status.editor) : undefined;
}
