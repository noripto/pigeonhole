import { ConfirmationModal, type App } from "obsidian";
import { msg } from "./i18n.ts";

class ConfirmModal extends ConfirmationModal {
  private confirmed = false;
  private resolve: (ok: boolean) => void;

  constructor(app: App, body: string, resolve: (ok: boolean) => void) {
    super(app);
    this.resolve = resolve;
    this.setTitle("Pigeonhole").setContent(body);
    this.addButton((b) =>
      b
        .setButtonText(msg.confirmRun)
        .setCta()
        .setInitialFocus()
        .onClick(() => {
          this.confirmed = true;
        }),
    );
    this.addCancelButton();
  }

  onClose() {
    super.onClose();
    this.resolve(this.confirmed);
  }
}

export const confirm = (app: App, body: string) =>
  new Promise<boolean>((resolve) => new ConfirmModal(app, body, resolve).open());
