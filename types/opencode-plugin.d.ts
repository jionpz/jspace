// types/opencode-plugin.d.ts — minimal ambient shim for `@opencode-ai/plugin`.
//
// The JSpace repo does not depend on OpenCode's package; the plugin template
// (templates/workbench/.opencode/plugins/jspace.ts) only uses the tiny surface
// below, and OpenCode's runtime supplies the real module in a user workbench.
// This shim keeps the repo build type-checking standalone. Keep in sync with the
// plugin template's usage only — do not vendor the whole OpenCode API here.
//
// The SessionClient surface mirrors the real SDK's `session.prompt` shape
// (@opencode-ai/sdk client): `path: { id }` + `body.parts` (TextPartInput) +
// `body.noReply` (inject a user message without triggering an AI response).
declare module "@opencode-ai/plugin" {
  export interface SessionClient {
    session: {
      prompt: (input: {
        path: { id: string };
        body: { parts: { type: "text"; text: string }[]; noReply?: boolean };
      }) => Promise<unknown>;
    };
  }
  export interface PluginInput {
    directory: string;
    client: SessionClient;
  }
  export interface Hooks {
    event?: (input: { event: { type: string; properties?: { sessionID?: string } } }) => Promise<void>;
    "experimental.session.compacting"?: (input: unknown, output: { context: string[] }) => Promise<void>;
  }
  export type Plugin = (input: PluginInput) => Promise<Hooks>;
}
