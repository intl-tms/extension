import { isHelpText, readHelpText, readSignInDescriptor, type SignInDescriptor } from "@intl-tms/core/tools";
import { SIGN_IN } from "./strings.js";

/**
 * Whether the website lets the Editor in, as the Page Host last heard it: set
 * by a refused answer and cleared by the next accepted one. The Extension
 * holds no credential; this is only what the website said.
 */
export type SignInStatus =
  | { state: "accepted"; /** Who the website says the Editor is. Shown only, never stored durably. */ editor?: string }
  | { state: "not-signed-in"; descriptor?: SignInDescriptor }
  | { state: "not-permitted"; help?: string };

/** The one line the Popup and the Side Panel show about signing in. */
export interface SignInLine {
  text: string;
  /** The address **Sign in** opens in a new tab. */
  signIn?: string;
  /** The website's own words, shown as plain text under the line. */
  help?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A sign-in status from storage or a message, validated: the descriptor and
 * help text as the Core reads them, and a name only when it is one short line
 * of text. Anything else is no status.
 */
export function readSignInStatus(value: unknown): SignInStatus | undefined {
  if (!isObject(value)) return undefined;
  if (value.state === "accepted") return isHelpText(value.editor) ? { state: "accepted", editor: value.editor } : { state: "accepted" };
  if (value.state === "not-signed-in") {
    const descriptor = readSignInDescriptor({ auth: value.descriptor });
    return descriptor === undefined ? { state: "not-signed-in" } : { state: "not-signed-in", descriptor };
  }
  if (value.state === "not-permitted") {
    const help = readHelpText(value.help);
    return help === undefined ? { state: "not-permitted" } : { state: "not-permitted", help };
  }
  return undefined;
}

/** What to tell the Editor, or nothing when the website accepts them. The first situation that applies. */
export function signInLine(status: SignInStatus | undefined): SignInLine | undefined {
  if (status === undefined || status.state === "accepted") return undefined;
  if (status.state === "not-permitted") return { text: SIGN_IN.forbidden, ...(status.help === undefined ? {} : { help: status.help }) };
  const { session, help } = status.descriptor ?? {};
  const line: SignInLine = session === undefined ? { text: SIGN_IN.refused } : { text: SIGN_IN.notSignedIn, signIn: session.signIn };
  if (help !== undefined) line.help = help;
  return line;
}

/** "Editing as <name>", when the website named the Editor. */
export function editingAs(status: SignInStatus | undefined): string | undefined {
  return status?.state === "accepted" && status.editor !== undefined ? SIGN_IN.editingAs(status.editor) : undefined;
}
