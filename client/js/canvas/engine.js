import { HistoryManager, createAddStrokeCommand } from "./history.js";
import { LocalBoardStore } from "../storage/local.js";
import { toolRegistry } from "./tools.js";

class CanvasEngine {
  constructor() {
    this.shell = document.querySelector(".board-shell");
    this.canvas = document.getElementById("board-canvas");
    this.frame = this.canvas.closest(".canvas-frame");
    this.ctx = this.canvas.getContext("2d");
    this.saveStatus = document.getElementById("save-status");
    this.zoomIndicator = document.getElementById("zoom-indicator");
    this.widthInput = document.getElementById("stroke-width");
    this.widthValue = document.getElementById("stroke-width-value");
    this.opacityInput = document.getElementById("stroke-opacity");
    this.opacityValue = document.getElementById("stroke-opacity-value");
    this.undoButton = document.getElementById("undo-button");
    this.redoButton = document.getElementById("redo-button");
    this.fitButton = document.getElementById("fit-button");
    this.exportButton = document.getElementById("export-button");
    this.toolbarToggle = document.getElementById("toolbar-toggle");
    this.toolbarClose = document.getElementById("toolbar-close");
    this.toolRail = document.getElementById("tool-rail");
    this.propertiesPanel = document.getElementById("properties-panel");
    this.propertiesClose = document.getElementById("properties-close");
    this.propertiesTitle = document.getElementById("properties-title");
    this.toolHelp = document.getElementById("tool-help");
    this.toolButtons = [...document.querySelectorAll("[data-tool]")];
    this.swatches = [...document.querySelectorAll(".swatch")];
    this.backgroundButtons = [...document.querySelectorAll("[data-background]")];

    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.background = "blank";
    this.activeTool = "pen";
    this.isPointerDown = false;
    this.shouldRender = true;
    this.strokes = [];
    this.draftStroke = null;
    this.toolbarOpen = false;
    this.propertiesOpen = false;
    this.boardStore = new LocalBoardStore();
    this.history = new HistoryManager(this);

    this.currentStyle = {
      color: "#000000",
      width: Number(this.widthInput.value),
      opacity: Number(this.opacityInput.value),
    };

    this.scheduleSave = this.boardStore.createSaver(
      () => this.createSnapshot(),
      (label) => this.setSaveStatus(label),
    );
  }

  async init() {
    try {
      this.bindUI();
      this.bindCanvasEvents();
      this.selectTool("pen");
      this.setToolbarOpen(false);
      this.setPropertiesOpen(false);
      this.resizeCanvas();
      await this.restoreState();
      this.history.restore();
      this.renderLoop();
    } catch (error) {
      console.error("Unable to initialize canvas engine", error);
      this.setSaveStatus("Init failed");
    }
  }

  bindUI() {
    this.toolbarToggle.addEventListener("click", () => {
      this.setToolbarOpen(!this.toolbarOpen);
    });

    this.toolbarClose.addEventListener("click", () => {
      this.setToolbarOpen(false);
    });

    this.propertiesClose.addEventListener("click", () => {
      this.setPropertiesOpen(false);
    });

    this.widthInput.addEventListener("input", () => {
      this.currentStyle.width = Number(this.widthInput.value);
      this.widthValue.textContent = `${this.currentStyle.width} px`;
    });

    this.opacityInput.addEventListener("input", () => {
      this.currentStyle.opacity = Number(this.opacityInput.value);
      this.opacityValue.textContent = `${Math.round(this.currentStyle.opacity * 100)}%`;
    });

    this.undoButton.addEventListener("click", () => {
      if (this.history.undo()) {
        this.afterStateChange();
      }
    });

    this.redoButton.addEventListener("click", () => {
      if (this.history.redo()) {
        this.afterStateChange();
      }
    });

    this.fitButton.addEventListener("click", () => {
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.zoomIndicator.textContent = "100%";
      this.afterStateChange();
    });

    this.exportButton.addEventListener("click", () => {
      const url = this.canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = "slateboard-phase1.png";
      link.click();
    });

    this.toolButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.selectTool(button.dataset.tool);
        this.setPropertiesOpen(true);
      });
    });

    this.swatches.forEach((button) => {
      button.addEventListener("click", () => {
        this.currentStyle.color = button.dataset.color;
        this.swatches.forEach((swatch) => swatch.classList.remove("is-selected"));
        button.classList.add("is-selected");
      });
    });

    this.backgroundButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.background = button.dataset.background;
        this.backgroundButtons.forEach((candidate) => candidate.classList.remove("is-active"));
        button.classList.add("is-active");
        this.afterStateChange();
      });
    });

    window.addEventListener("resize", () => {
      this.resizeCanvas();
    });

    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          if (this.history.redo()) {
            this.afterStateChange();
          }
          return;
        }

        if (this.history.undo()) {
          this.afterStateChange();
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();

        if (this.history.redo()) {
          this.afterStateChange();
        }
      }

      if (event.key === "Escape") {
        this.setPropertiesOpen(false);
        this.setToolbarOpen(false);
      }
    });
  }

  bindCanvasEvents() {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      const tool = toolRegistry[this.activeTool];

      if (!tool) {
        this.setSaveStatus(`${this.activeTool} coming soon`);
        return;
      }

      this.canvas.setPointerCapture(event.pointerId);
      this.isPointerDown = true;

      const point = this.getCanvasPoint(event);
      this.draftStroke = tool.createStroke(this.currentStyle);
      tool.appendPoint(this.draftStroke, point);
      this.requestRender();
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.isPointerDown || !this.draftStroke) {
        return;
      }

      const point = this.getCanvasPoint(event);
      const tool = toolRegistry[this.activeTool];

      if (!tool) {
        return;
      }

      tool.appendPoint(this.draftStroke, point);
      this.requestRender();
    });

    const completeStroke = (event) => {
      if (!this.isPointerDown || !this.draftStroke) {
        return;
      }

      const point = this.getCanvasPoint(event);
      const tool = toolRegistry[this.activeTool];

      if (!tool) {
        this.draftStroke = null;
        this.isPointerDown = false;
        return;
      }

      tool.appendPoint(this.draftStroke, point);
      const completedStroke = structuredClone(this.draftStroke);
      this.draftStroke = null;
      this.isPointerDown = false;
      this.history.execute(createAddStrokeCommand(completedStroke));
      this.afterStateChange();
    };

    this.canvas.addEventListener("pointerup", completeStroke);
    this.canvas.addEventListener("pointercancel", () => {
      this.draftStroke = null;
      this.isPointerDown = false;
      this.requestRender();
    });
  }

  resizeCanvas() {
    const rect = this.frame.getBoundingClientRect();
    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.canvas.style.cursor = toolRegistry[this.activeTool]?.cursor ?? "not-allowed";
    this.requestRender();
  }

  getCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.camera.x) / this.camera.zoom,
      y: (event.clientY - rect.top - this.camera.y) / this.camera.zoom,
      pressure: event.pressure > 0 ? event.pressure : null,
      t: performance.now(),
    };
  }

  addStroke(stroke) {
    this.strokes.push(stroke);
    this.requestRender();
  }

  removeStroke(strokeId) {
    this.strokes = this.strokes.filter((stroke) => stroke.id !== strokeId);
    this.requestRender();
  }

  createSnapshot() {
    return {
      savedAt: Date.now(),
      background: this.background,
      camera: this.camera,
      strokes: this.strokes,
    };
  }

  async restoreState() {
    try {
      const snapshot = await this.boardStore.load();

      if (!snapshot) {
        return;
      }

      this.background = snapshot.background ?? "blank";
      this.camera = snapshot.camera ?? { x: 0, y: 0, zoom: 1 };
      this.strokes = snapshot.strokes ?? [];
      this.zoomIndicator.textContent = `${Math.round(this.camera.zoom * 100)}%`;

      this.backgroundButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.background === this.background);
      });

      this.requestRender();
    } catch (error) {
      console.error("Unable to restore board state", error);
    }
  }

  setSaveStatus(label) {
    this.saveStatus.textContent = label;
  }

  setToolbarOpen(isOpen) {
    this.toolbarOpen = isOpen;
    this.shell.dataset.toolbarOpen = String(isOpen);
    this.toolbarToggle.setAttribute("aria-expanded", String(isOpen));
    this.toolRail.hidden = !isOpen;
  }

  setPropertiesOpen(isOpen) {
    this.propertiesOpen = isOpen;
    this.shell.dataset.propertiesOpen = String(isOpen);
    this.propertiesPanel.hidden = !isOpen;
  }

  selectTool(toolName) {
    this.activeTool = toolName;
    const labels = {
      pen: {
        button: "Pen",
        title: "Pen",
        help: "Pen is fully active. Adjust weight, opacity, color, and background here.",
      },
      line: {
        button: "Line",
        title: "Line",
        help: "Line settings panel is ready, but line drawing is not wired yet in this phase.",
      },
      rect: {
        button: "Rect",
        title: "Rectangle",
        help: "Rectangle settings are staged here. The drawing action lands in a later pass.",
      },
      ellipse: {
        button: "Ellipse",
        title: "Ellipse",
        help: "Ellipse settings are staged here. The drawing action lands in a later pass.",
      },
      arrow: {
        button: "Arrow",
        title: "Arrow",
        help: "Arrow settings are staged here. The drawing action lands in a later pass.",
      },
      text: {
        button: "Text",
        title: "Text",
        help: "Text settings are staged here. The drawing action lands in a later pass.",
      },
      eraser: {
        button: "Erase",
        title: "Eraser",
        help: "Eraser settings are staged here. The erase behavior lands in a later pass.",
      },
    };

    const config = labels[toolName] ?? labels.pen;
    this.toolbarToggle.textContent = config.button;
    this.canvas.style.cursor = toolRegistry[toolName]?.cursor ?? "not-allowed";

    this.toolButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tool === toolName);
    });

    this.propertiesTitle.textContent = config.title;
    this.toolHelp.textContent = config.help;
  }

  afterStateChange() {
    this.requestRender();
    this.scheduleSave();
  }

  requestRender() {
    this.shouldRender = true;
  }

  renderLoop() {
    window.requestAnimationFrame(() => this.renderLoop());

    if (!this.shouldRender) {
      return;
    }

    this.shouldRender = false;
    this.render();
  }

  renderBackground(width, height) {
    this.ctx.fillStyle = this.background === "white" ? "#ffffff" : "#fffdf5";
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.strokeStyle = "#000000";
    this.ctx.globalAlpha = 0.12;

    if (this.background === "dot") {
      for (let x = 20; x < width; x += 24) {
        for (let y = 20; y < height; y += 24) {
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.25, 0, Math.PI * 2);
          this.ctx.fillStyle = "#000000";
          this.ctx.fill();
        }
      }
    }

    if (this.background === "line") {
      for (let x = 0; x < width; x += 28) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, height);
        this.ctx.stroke();
      }

      for (let y = 0; y < height; y += 28) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(width, y);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  render() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.renderBackground(width, height);

    this.ctx.save();
    this.ctx.translate(this.camera.x, this.camera.y);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);

    const strokes = this.draftStroke ? [...this.strokes, this.draftStroke] : this.strokes;

    strokes.forEach((stroke) => {
      const tool = toolRegistry[stroke.tool];

      if (tool) {
        tool.draw(this.ctx, stroke);
      }
    });

    this.ctx.restore();
  }
}

const slateboardEngine = new CanvasEngine();
slateboardEngine.init();
