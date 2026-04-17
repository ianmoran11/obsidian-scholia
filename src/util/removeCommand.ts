import { App, Notice } from "obsidian";

export function removeCommand(app: App, commandId: string): void {
  try {
    (
      app as unknown as { commands: { removeCommand: (id: string) => void } }
    ).commands.removeCommand(commandId);
  } catch (e) {
    new Notice(
      `Template removed — please reload Obsidian to fully unregister the command.`,
    );
  }
}
