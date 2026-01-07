import {
  InnerEditorEvent,
  RenderEvent,
  Text,
  type IPointData,
  type ITextInputData,
} from "leafer-editor";

import type { ConnectorOptions } from "../types";

type EmitChange = (reason: "label") => void;
type RequestUpdate = (reason?: "render" | "invalidate" | "event") => void;

export class LabelManager {
  private _label?: Text;
  private _lastLabelText: string | null = null;
  private _labelChangePending = false;

  constructor(private readonly deps: {
    add: (label: Text) => void;
    updateNow: () => void;
    invalidateKey: () => void;
    emitChange: EmitChange;
    requestUpdate: RequestUpdate;

    getLabelConfig: () => ConnectorOptions["label"] | undefined;
    setLabelConfig: (cfg: ConnectorOptions["label"] | undefined) => void;
    onLabelChange?: ConnectorOptions["onLabelChange"];
  }) {}

  get label() {
    return this._label;
  }

  /**
   * 用于 setState/协同回放：把外部 state 的 label 同步到节点，但不触发 onLabelChange / emitChange。
   */
  applyFromState(cfg: ConnectorOptions["label"] | undefined) {
    if (!cfg || String(cfg.text ?? "").trim() === "") {
      // 静默删除
      if (this._label) {
        this._label.destroy();
        this._label = undefined;
      }
      this._lastLabelText = null;
      this.deps.setLabelConfig(cfg);
      this.deps.invalidateKey();
      return;
    }

    // ensure
    this.deps.setLabelConfig(cfg);
    const label = this.ensureLabel();
    if (cfg.text != null) label.text = cfg.text;
    if (cfg.style) this.setLabelStyle(cfg.style);
    this._lastLabelText = String(label.text ?? "");
  }

  ensureLabel() {
    if (this._label) return this._label;
    const cfg = this.deps.getLabelConfig() || {};
    const style = (cfg.style || {}) as Partial<ITextInputData>;

    const withDefaultBg: Partial<ITextInputData> = {
      fill: "#ffffff",
      fontSize: 12,
      padding: [2, 6],
      boxStyle: { fill: "#00000099", cornerRadius: 6 },
      ...style,
    };

    const label = new Text({
      ...withDefaultBg,
      text: cfg.text ?? withDefaultBg.text ?? "",
      textAlign: "center",
      verticalAlign: "middle",
      autoSizeAlign: true,
      editable: cfg.editable !== false,
      editConfig: {
        movable: false,
        moveable: false,
        resizeable: false,
        rotateable: false,
        skewable: false,
      },
      draggable: false,
      hitStrokeWidth: 8,
    });

    this._label = label;
    this._lastLabelText = String(label.text ?? "");
    this.deps.setLabelConfig({ ...cfg, text: String(label.text ?? "") });
    this.deps.add(label);
    this.deps.invalidateKey();
    this.deps.updateNow();

    label.on_(InnerEditorEvent.CLOSE, () => {
      if (this._label !== label) return;
      const raw = String(label.text ?? "");
      const trimmed = raw.trim();
      const prev = String(this._lastLabelText ?? "");

      if (trimmed === "") {
        this.removeLabelNode(prev);
        return;
      }

      if (trimmed !== raw) label.text = trimmed;
      this._lastLabelText = trimmed;
      this.deps.setLabelConfig({
        ...(this.deps.getLabelConfig() || {}),
        text: trimmed,
      });

      const editor = label.app.editor;
      if (editor?.getItem?.() === label) editor.cancel?.();

      if (prev !== trimmed) {
        this.deps.onLabelChange?.({ oldText: prev, newText: trimmed });
        this.deps.emitChange("label");
      }
      this.deps.requestUpdate("event");
    });

    label.on_(RenderEvent.END, () => {
      if (this._label !== label) return;
      const cur = String(label.text ?? "");
      const prev = this._lastLabelText ?? "";
      if (cur === prev) return;
      this._lastLabelText = cur;

      if (this._labelChangePending) return;
      this._labelChangePending = true;
      queueMicrotask(() => {
        this._labelChangePending = false;
        if (this._label !== label) return;
        const now = String(label.text ?? "");
        const old = prev;

        if (now.trim() === "") {
          this.removeLabelNode(old);
          return;
        }

        if (now !== old) {
          this.deps.setLabelConfig({
            ...(this.deps.getLabelConfig() || {}),
            text: now,
          });
          this.deps.onLabelChange?.({ oldText: old, newText: now });
          this.deps.emitChange("label");
          this.deps.requestUpdate("event");
        }
      });
    });

    return label;
  }

  removeLabelNode(oldText?: string) {
    const label = this._label;
    if (!label) return;
    label.destroy();
    this._label = undefined;
    this._lastLabelText = null;
    this.deps.setLabelConfig(undefined);
    this.deps.invalidateKey();

    const prev = String(oldText ?? "");
    if (prev.trim() !== "") this.deps.onLabelChange?.({ oldText: prev, newText: "" });
    this.deps.emitChange("label");
    this.deps.requestUpdate("event");
  }

  setLabelText(text: string) {
    const next = String(text ?? "").trim();
    if (next === "") {
      const old = String(this._label?.text ?? this.deps.getLabelConfig()?.text ?? "");
      this.removeLabelNode(old);
      return;
    }

    const label = this.ensureLabel();
    const old = String(label.text ?? "");
    label.text = next;
    const now = String(label.text ?? "");
    this.deps.setLabelConfig({ ...(this.deps.getLabelConfig() || {}), text: now });

    if (old !== now) {
      this.deps.onLabelChange?.({ oldText: old, newText: now });
      this.deps.emitChange("label");
    }
    this.deps.requestUpdate("event");
  }

  setLabelStyle(style: Partial<ITextInputData>) {
    const label = this.ensureLabel();
    label.set({
      ...style,
      textAlign: "center",
      verticalAlign: "middle",
      autoSizeAlign: true,
    });
    this.deps.requestUpdate("event");
  }

  openOrCreateLabelEditor() {
    if (!this._label) {
      const cur = String(this.deps.getLabelConfig()?.text ?? "");
      if (cur.trim() === "") {
        this.deps.setLabelConfig({
          ...(this.deps.getLabelConfig() || {}),
          text: "默认文案",
          editable: true,
        });
      }
    }
    this.ensureLabel();
    this.deps.updateNow();
  }

  setPosition(midLocal: IPointData) {
    if (!this._label) return;
    this._label.set({ x: midLocal.x, y: midLocal.y });
  }
}


