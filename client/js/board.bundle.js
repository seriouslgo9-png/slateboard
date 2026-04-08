(function () {
  const MAX_POINTS = 500;
  const DB_NAME = "slateboard-phase1";
  const STORE_NAME = "boards";
  const BOARD_KEY = "local-board";
  const HISTORY_KEY = "slateboard.phase1.history";

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function interpolatePoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;

    return {
      x:
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y:
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      pressure:
        0.5 *
        ((2 * p1.pressure) +
          (-p0.pressure + p2.pressure) * t +
          (2 * p0.pressure - 5 * p1.pressure + 4 * p2.pressure - p3.pressure) * t2 +
          (-p0.pressure + 3 * p1.pressure - 3 * p2.pressure + p3.pressure) * t3),
      t: p1.t + (p2.t - p1.t) * t,
    };
  }

  function ramerDouglasPeucker(points, epsilon) {
    if (points.length < 3) {
      return points;
    }

    let maxDistance = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];
    const baseLength = distance(first, last) || 1;

    for (let i = 1; i < points.length - 1; i += 1) {
      const point = points[i];
      const numerator = Math.abs(
        (last.y - first.y) * point.x -
          (last.x - first.x) * point.y +
          last.x * first.y -
          last.y * first.x,
      );
      const perpendicular = numerator / baseLength;

      if (perpendicular > maxDistance) {
        maxDistance = perpendicular;
        index = i;
      }
    }

    if (maxDistance > epsilon) {
      const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
      const right = ramerDouglasPeucker(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }

    return [first, last];
  }

  function simplifyStrokePoints(points) {
    if (points.length <= MAX_POINTS) {
      return points;
    }

    const head = points.slice(0, 40);
    const tail = ramerDouglasPeucker(points.slice(40), 0.85);
    return head.concat(tail).slice(0, MAX_POINTS);
  }

  function createStroke(tool, style) {
    return {
      id: window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()),
      tool: tool,
      style: {
        color: style.color,
        width: Number(style.width),
        opacity: Number(style.opacity),
        fill: Boolean(style.fill),
      },
      points: [],
      createdAt: Date.now(),
    };
  }

  function setStrokeEndpoint(stroke, point) {
    if (stroke.points.length === 0) {
      stroke.points = [point];
      return;
    }

    if (stroke.points.length === 1) {
      stroke.points.push(point);
      return;
    }

    stroke.points[stroke.points.length - 1] = point;
  }

  function appendPointToStroke(stroke, point) {
    const previous = stroke.points[stroke.points.length - 1];
    const timestamp = point.t || performance.now();
    let pressure = point.pressure;

    if (previous && pressure == null) {
      const travel = distance(previous, point);
      const elapsed = Math.max(timestamp - previous.t, 1);
      const velocity = travel / elapsed;
      pressure = clamp(1.35 - velocity * 0.18, 0.2, 1);
    }

    if (!previous && pressure == null) {
      pressure = 1;
    }

    stroke.points = simplifyStrokePoints(
      stroke.points.concat({
        x: point.x,
        y: point.y,
        pressure: pressure,
        t: timestamp,
      }),
    );
  }

  function drawDot(ctx, point, style) {
    ctx.save();
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(style.width * point.pressure * 0.5, 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPenStroke(ctx, stroke) {
    if (!stroke || stroke.points.length === 0) {
      return;
    }

    if (stroke.points.length === 1) {
      drawDot(ctx, stroke.points[0], stroke.style);
      return;
    }

    const points = stroke.points;
    ctx.save();
    ctx.fillStyle = stroke.style.color;
    ctx.globalAlpha = stroke.style.opacity;

    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const samples = Math.max(6, Math.ceil(distance(p1, p2) / 2));
      let previous = p1;

      for (let step = 1; step <= samples; step += 1) {
        const t = step / samples;
        const current = interpolatePoint(p0, p1, p2, p3, t);
        const width = Math.max(stroke.style.width * ((previous.pressure + current.pressure) / 2), 0.75);
        const angle = Math.atan2(current.y - previous.y, current.x - previous.x);
        const normalX = Math.cos(angle + Math.PI / 2) * width * 0.5;
        const normalY = Math.sin(angle + Math.PI / 2) * width * 0.5;

        ctx.beginPath();
        ctx.moveTo(previous.x - normalX, previous.y - normalY);
        ctx.lineTo(previous.x + normalX, previous.y + normalY);
        ctx.lineTo(current.x + normalX, current.y + normalY);
        ctx.lineTo(current.x - normalX, current.y - normalY);
        ctx.closePath();
        ctx.fill();

        previous = current;
      }
    }

    ctx.restore();
  }

  function applyStrokeStyle(ctx, style) {
    ctx.lineWidth = style.width;
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function drawLineStroke(ctx, stroke) {
    if (stroke.points.length < 2) {
      return;
    }

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    ctx.save();
    applyStrokeStyle(ctx, stroke.style);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawRectStroke(ctx, stroke) {
    if (stroke.points.length < 2) {
      return;
    }

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    ctx.save();
    applyStrokeStyle(ctx, stroke.style);
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    if (stroke.style.fill) {
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawEllipseStroke(ctx, stroke) {
    if (stroke.points.length < 2) {
      return;
    }

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    ctx.save();
    applyStrokeStyle(ctx, stroke.style);
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, Math.max(radiusX, 1), Math.max(radiusY, 1), 0, 0, Math.PI * 2);
    if (stroke.style.fill) {
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawArrowStroke(ctx, stroke) {
    if (stroke.points.length < 2) {
      return;
    }

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headLength = Math.max(stroke.style.width * 3, 12);
    const leftX = end.x - headLength * Math.cos(angle - Math.PI / 6);
    const leftY = end.y - headLength * Math.sin(angle - Math.PI / 6);
    const rightX = end.x - headLength * Math.cos(angle + Math.PI / 6);
    const rightY = end.y - headLength * Math.sin(angle + Math.PI / 6);

    ctx.save();
    applyStrokeStyle(ctx, stroke.style);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawTextStroke(ctx, stroke) {
    if (!stroke.text || stroke.points.length === 0) {
      return;
    }

    const origin = stroke.points[0];
    ctx.save();
    ctx.fillStyle = stroke.style.color;
    ctx.globalAlpha = stroke.style.opacity;
    ctx.font = "900 " + Math.max(stroke.style.width * 4, 18) + "px Space Grotesk, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(stroke.text, origin.x, origin.y);
    ctx.restore();
  }

  function drawEraserStroke(ctx, stroke) {
    if (!stroke || stroke.points.length === 0) {
      return;
    }

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    drawPenStroke(ctx, stroke);
    ctx.restore();
  }

  function createAddStrokeCommand(stroke) {
    const payload = {
      stroke: structuredClone(stroke),
    };

    return {
      type: "add-stroke",
      payload: payload,
      apply: function (target) {
        target.addStroke(structuredClone(payload.stroke));
      },
      revert: function (target) {
        target.removeStroke(payload.stroke.id);
      },
    };
  }

  function serializeCommand(command) {
    return {
      type: command.type,
      payload: command.payload,
    };
  }

  function deserializeCommand(record) {
    if (!record || record.type !== "add-stroke") {
      return null;
    }

    return createAddStrokeCommand(record.payload.stroke);
  }

  function HistoryManager(target) {
    this.target = target;
    this.past = [];
    this.future = [];
  }

  HistoryManager.prototype.execute = function (command) {
    command.apply(this.target);
    this.past.push(command);
    this.future = [];
    this.persist();
  };

  HistoryManager.prototype.undo = function () {
    const command = this.past.pop();

    if (!command) {
      return false;
    }

    command.revert(this.target);
    this.future.push(command);
    this.persist();
    return true;
  };

  HistoryManager.prototype.redo = function () {
    const command = this.future.pop();

    if (!command) {
      return false;
    }

    command.apply(this.target);
    this.past.push(command);
    this.persist();
    return true;
  };

  HistoryManager.prototype.persist = function () {
    const snapshot = {
      past: this.past.map(serializeCommand),
      future: this.future.map(serializeCommand),
    };

    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(snapshot));
  };

  HistoryManager.prototype.restore = function () {
    const raw = window.localStorage.getItem(HISTORY_KEY);

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      this.past = (parsed.past || []).map(deserializeCommand).filter(Boolean);
      this.future = (parsed.future || []).map(deserializeCommand).filter(Boolean);
    } catch (error) {
      this.past = [];
      this.future = [];
    }
  };

  function createDebounced(fn, wait) {
    let timeoutId = 0;

    return function () {
      const args = arguments;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  function LocalBoardStore() {
    this.dbPromise = null;
  }

  LocalBoardStore.prototype.open = function () {
    if (!window.indexedDB) {
      return Promise.reject(new Error("IndexedDB unavailable"));
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise(function (resolve, reject) {
      const request = window.indexedDB.open(DB_NAME, 1);

      request.onerror = function () {
        reject(request.error);
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onupgradeneeded = function () {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });

    return this.dbPromise;
  };

  LocalBoardStore.prototype.save = async function (snapshot) {
    try {
      const db = await this.open();

      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(snapshot, BOARD_KEY);
        tx.oncomplete = resolve;
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    } catch (error) {
      window.localStorage.setItem(BOARD_KEY, JSON.stringify(snapshot));
    }
  };

  LocalBoardStore.prototype.load = async function () {
    try {
      const db = await this.open();

      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(BOARD_KEY);
        request.onsuccess = function () {
          resolve(request.result || null);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    } catch (error) {
      const raw = window.localStorage.getItem(BOARD_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  };

  LocalBoardStore.prototype.createSaver = function (getSnapshot, onStatusChange) {
    const store = this;
    return createDebounced(async function () {
      onStatusChange("Saving...");

      try {
        await store.save(getSnapshot());
        onStatusChange("Saved");
      } catch (error) {
        onStatusChange("Save failed");
      }
    }, 500);
  };

  const TOOL_META = {
    pen: {
      button: "Pen",
      title: "Pen",
      help: "Pen is fully active. Adjust weight, opacity, color, and background here.",
      cursor: "crosshair",
      draw: true,
    },
    line: {
      button: "Line",
      title: "Line",
      help: "Drag to place a straight line.",
      cursor: "crosshair",
      draw: true,
    },
    rect: {
      button: "Rect",
      title: "Rectangle",
      help: "Drag to create a rectangle. Turn on fill for solid blocks.",
      cursor: "crosshair",
      draw: true,
    },
    ellipse: {
      button: "Ellipse",
      title: "Ellipse",
      help: "Drag to create an ellipse. Turn on fill for solid shapes.",
      cursor: "crosshair",
      draw: true,
    },
    arrow: {
      button: "Arrow",
      title: "Arrow",
      help: "Drag to place an arrow with a filled head.",
      cursor: "crosshair",
      draw: true,
    },
    text: {
      button: "Text",
      title: "Text",
      help: "Click anywhere on the board to place text.",
      cursor: "text",
      draw: true,
    },
    eraser: {
      button: "Erase",
      title: "Eraser",
      help: "Draw over marks to erase them locally.",
      cursor: "cell",
      draw: true,
    },
  };

  function CanvasEngine() {
    this.shell = document.querySelector(".board-shell");
    this.canvas = document.getElementById("board-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.saveStatus = document.getElementById("save-status");
    this.zoomIndicator = document.getElementById("zoom-indicator");
    this.widthInput = document.getElementById("stroke-width");
    this.widthValue = document.getElementById("stroke-width-value");
    this.opacityInput = document.getElementById("stroke-opacity");
    this.opacityValue = document.getElementById("stroke-opacity-value");
    this.fillToggle = document.getElementById("fill-toggle");
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
    this.toolButtons = Array.prototype.slice.call(document.querySelectorAll("[data-tool]"));
    this.swatches = Array.prototype.slice.call(document.querySelectorAll(".swatch"));
    this.backgroundButtons = Array.prototype.slice.call(document.querySelectorAll("[data-background]"));

    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.viewport = { width: window.innerWidth, height: window.innerHeight };
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.background = "blank";
    this.activeTool = "pen";
    this.toolbarOpen = false;
    this.propertiesOpen = false;
    this.spacePressed = false;
    this.isPanning = false;
    this.isPointerDown = false;
    this.pointerId = null;
    this.panStart = null;
    this.shouldRender = true;
    this.strokes = [];
    this.draftStroke = null;
    this.history = new HistoryManager(this);
    this.boardStore = new LocalBoardStore();
    this.currentStyle = {
      color: "#000000",
      width: Number(this.widthInput.value),
      opacity: Number(this.opacityInput.value),
      fill: false,
    };
    this.scheduleSave = this.boardStore.createSaver(
      this.createSnapshot.bind(this),
      this.setSaveStatus.bind(this),
    );
  }

  CanvasEngine.prototype.init = async function () {
    this.bindUI();
    this.selectTool("pen");
    this.setToolbarOpen(false);
    this.setPropertiesOpen(false);
    this.resizeCanvas();
    await this.restoreState();
    this.history.restore();
    this.renderLoop();
  };

  CanvasEngine.prototype.bindUI = function () {
    const engine = this;

    this.toolbarToggle.addEventListener("click", function () {
      engine.setToolbarOpen(!engine.toolbarOpen);
    });

    this.toolbarClose.addEventListener("click", function () {
      engine.setToolbarOpen(false);
    });

    this.propertiesClose.addEventListener("click", function () {
      engine.setPropertiesOpen(false);
    });

    this.toolButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        engine.selectTool(button.dataset.tool);
        engine.setToolbarOpen(false);
        engine.setPropertiesOpen(true);
      });
    });

    this.widthInput.addEventListener("input", function () {
      engine.currentStyle.width = Number(engine.widthInput.value);
      engine.widthValue.textContent = engine.currentStyle.width + " px";
    });

    this.opacityInput.addEventListener("input", function () {
      engine.currentStyle.opacity = Number(engine.opacityInput.value);
      engine.opacityValue.textContent = Math.round(engine.currentStyle.opacity * 100) + "%";
    });

    this.fillToggle.addEventListener("change", function () {
      engine.currentStyle.fill = engine.fillToggle.checked;
    });

    this.swatches.forEach(function (button) {
      button.addEventListener("click", function () {
        engine.currentStyle.color = button.dataset.color;
        engine.swatches.forEach(function (swatch) {
          swatch.classList.remove("is-selected");
        });
        button.classList.add("is-selected");
      });
    });

    this.backgroundButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        engine.background = button.dataset.background;
        engine.backgroundButtons.forEach(function (candidate) {
          candidate.classList.remove("is-active");
        });
        button.classList.add("is-active");
        engine.afterStateChange();
      });
    });

    this.undoButton.addEventListener("click", function () {
      if (engine.history.undo()) {
        engine.afterStateChange();
      }
    });

    this.redoButton.addEventListener("click", function () {
      if (engine.history.redo()) {
        engine.afterStateChange();
      }
    });

    this.fitButton.addEventListener("click", function () {
      engine.camera = { x: 0, y: 0, zoom: 1 };
      engine.zoomIndicator.textContent = "100%";
      engine.afterStateChange();
    });

    this.exportButton.addEventListener("click", function () {
      const url = engine.canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = "slateboard-board.png";
      link.click();
    });

    window.addEventListener("resize", function () {
      engine.resizeCanvas();
    });

    window.addEventListener("keydown", function (event) {
      if (event.code === "Space") {
        engine.spacePressed = true;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          if (engine.history.redo()) {
            engine.afterStateChange();
          }
        } else if (engine.history.undo()) {
          engine.afterStateChange();
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        if (engine.history.redo()) {
          engine.afterStateChange();
        }
      }

      if (event.key === "Escape") {
        engine.setToolbarOpen(false);
        engine.setPropertiesOpen(false);
      }
    });

    window.addEventListener("keyup", function (event) {
      if (event.code === "Space") {
        engine.spacePressed = false;
      }
    });

    this.canvas.addEventListener("wheel", function (event) {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();

      const rect = engine.canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const worldX = engine.screenToWorldX(screenX);
      const worldY = engine.screenToWorldY(screenY);
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      const nextZoom = clamp(engine.camera.zoom * factor, 0.25, 4);
      engine.camera.x = screenX - worldX * nextZoom;
      engine.camera.y = screenY - worldY * nextZoom;
      engine.camera.zoom = nextZoom;
      engine.zoomIndicator.textContent = Math.round(nextZoom * 100) + "%";
      engine.afterStateChange();
    }, { passive: false });

    this.canvas.addEventListener("pointerdown", function (event) {
      if (event.button === 1 || engine.spacePressed) {
        engine.startPan(event);
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const meta = TOOL_META[engine.activeTool];

      if (!meta || !meta.draw) {
        engine.setSaveStatus(meta ? meta.title + " coming soon" : "Unavailable");
        return;
      }

      if (engine.activeTool === "text") {
        const content = window.prompt("Enter text");

        if (!content) {
          return;
        }

        const point = engine.getWorldPoint(event);
        const stroke = createStroke("text", engine.currentStyle);
        stroke.text = content;
        stroke.points = [point];
        engine.history.execute(createAddStrokeCommand(stroke));
        engine.afterStateChange();
        return;
      }

      engine.canvas.setPointerCapture(event.pointerId);
      engine.pointerId = event.pointerId;
      engine.isPointerDown = true;

      const point = engine.getWorldPoint(event);
      engine.draftStroke = createStroke(engine.activeTool, engine.currentStyle);
      if (engine.activeTool === "pen" || engine.activeTool === "eraser") {
        appendPointToStroke(engine.draftStroke, point);
      } else {
        engine.draftStroke.points = [point, point];
      }
      engine.requestRender();
    });

    this.canvas.addEventListener("pointermove", function (event) {
      if (engine.isPanning) {
        engine.updatePan(event);
        return;
      }

      if (!engine.isPointerDown || !engine.draftStroke) {
        return;
      }

      const point = engine.getWorldPoint(event);

      if (engine.activeTool === "pen" || engine.activeTool === "eraser") {
        appendPointToStroke(engine.draftStroke, point);
      } else {
        setStrokeEndpoint(engine.draftStroke, point);
      }
      engine.requestRender();
    });

    this.canvas.addEventListener("pointerup", function (event) {
      if (engine.isPanning) {
        engine.stopPan();
        return;
      }

      if (!engine.isPointerDown || !engine.draftStroke) {
        return;
      }

      const point = engine.getWorldPoint(event);

      if (engine.activeTool === "pen" || engine.activeTool === "eraser") {
        appendPointToStroke(engine.draftStroke, point);
      } else {
        setStrokeEndpoint(engine.draftStroke, point);
      }
      const finished = structuredClone(engine.draftStroke);
      engine.draftStroke = null;
      engine.isPointerDown = false;
      engine.pointerId = null;
      engine.history.execute(createAddStrokeCommand(finished));
      engine.afterStateChange();
    });

    this.canvas.addEventListener("pointercancel", function () {
      engine.draftStroke = null;
      engine.isPointerDown = false;
      engine.stopPan();
      engine.requestRender();
    });
  };

  CanvasEngine.prototype.startPan = function (event) {
    this.isPanning = true;
    this.panStart = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
    };
    this.canvas.style.cursor = "grabbing";
    this.canvas.setPointerCapture(event.pointerId);
  };

  CanvasEngine.prototype.updatePan = function (event) {
    if (!this.panStart) {
      return;
    }

    this.camera.x = this.panStart.cameraX + (event.clientX - this.panStart.pointerX);
    this.camera.y = this.panStart.cameraY + (event.clientY - this.panStart.pointerY);
    this.afterStateChange();
  };

  CanvasEngine.prototype.stopPan = function () {
    this.isPanning = false;
    this.panStart = null;
    this.canvas.style.cursor = TOOL_META[this.activeTool].cursor;
  };

  CanvasEngine.prototype.resizeCanvas = function () {
    this.viewport.width = window.innerWidth;
    this.viewport.height = window.innerHeight;
    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.canvas.width = Math.floor(this.viewport.width * this.dpr);
    this.canvas.height = Math.floor(this.viewport.height * this.dpr);
    this.canvas.style.width = this.viewport.width + "px";
    this.canvas.style.height = this.viewport.height + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.canvas.style.cursor = TOOL_META[this.activeTool].cursor;
    this.requestRender();
  };

  CanvasEngine.prototype.screenToWorldX = function (screenX) {
    return (screenX - this.camera.x) / this.camera.zoom;
  };

  CanvasEngine.prototype.screenToWorldY = function (screenY) {
    return (screenY - this.camera.y) / this.camera.zoom;
  };

  CanvasEngine.prototype.getWorldPoint = function (event) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    return {
      x: this.screenToWorldX(screenX),
      y: this.screenToWorldY(screenY),
      pressure: event.pressure > 0 ? event.pressure : null,
      t: performance.now(),
    };
  };

  CanvasEngine.prototype.addStroke = function (stroke) {
    this.strokes.push(stroke);
    this.requestRender();
  };

  CanvasEngine.prototype.removeStroke = function (strokeId) {
    this.strokes = this.strokes.filter(function (stroke) {
      return stroke.id !== strokeId;
    });
    this.requestRender();
  };

  CanvasEngine.prototype.createSnapshot = function () {
    return {
      background: this.background,
      camera: this.camera,
      strokes: this.strokes,
      savedAt: Date.now(),
    };
  };

  CanvasEngine.prototype.restoreState = async function () {
    const snapshot = await this.boardStore.load();

    if (!snapshot) {
      return;
    }

    this.background = snapshot.background || "blank";
    this.camera = snapshot.camera || { x: 0, y: 0, zoom: 1 };
    this.strokes = snapshot.strokes || [];
    this.zoomIndicator.textContent = Math.round(this.camera.zoom * 100) + "%";
    this.backgroundButtons.forEach(
      function (button) {
        button.classList.toggle("is-active", button.dataset.background === this.background);
      }.bind(this),
    );
    this.requestRender();
  };

  CanvasEngine.prototype.setSaveStatus = function (label) {
    this.saveStatus.textContent = label;
  };

  CanvasEngine.prototype.setToolbarOpen = function (isOpen) {
    this.toolbarOpen = isOpen;
    this.shell.dataset.toolbarOpen = String(isOpen);
    this.toolbarToggle.setAttribute("aria-expanded", String(isOpen));
    this.toolRail.hidden = !isOpen;
  };

  CanvasEngine.prototype.setPropertiesOpen = function (isOpen) {
    this.propertiesOpen = isOpen;
    this.shell.dataset.propertiesOpen = String(isOpen);
    this.propertiesPanel.hidden = !isOpen;
  };

  CanvasEngine.prototype.selectTool = function (toolName) {
    const meta = TOOL_META[toolName] || TOOL_META.pen;
    this.activeTool = toolName;
    this.toolbarToggle.textContent = meta.button;
    this.propertiesTitle.textContent = meta.title;
    this.toolHelp.textContent = meta.help;
    this.canvas.style.cursor = meta.cursor;
    this.fillToggle.checked = this.currentStyle.fill;

    this.toolButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.tool === toolName);
    });
  };

  CanvasEngine.prototype.afterStateChange = function () {
    this.requestRender();
    this.scheduleSave();
  };

  CanvasEngine.prototype.requestRender = function () {
    this.shouldRender = true;
  };

  CanvasEngine.prototype.renderLoop = function () {
    const engine = this;
    window.requestAnimationFrame(function () {
      engine.renderLoop();
    });

    if (!this.shouldRender) {
      return;
    }

    this.shouldRender = false;
    this.render();
  };

  CanvasEngine.prototype.renderBackground = function (width, height) {
    this.ctx.fillStyle = this.background === "white" ? "#ffffff" : "#fffdf5";
    this.ctx.fillRect(0, 0, width, height);

    if (this.background === "blank" || this.background === "white") {
      return;
    }

    const zoom = this.camera.zoom;
    const left = this.screenToWorldX(0);
    const top = this.screenToWorldY(0);
    const right = this.screenToWorldX(width);
    const bottom = this.screenToWorldY(height);

    this.ctx.save();
    this.ctx.translate(this.camera.x, this.camera.y);
    this.ctx.scale(zoom, zoom);
    this.ctx.strokeStyle = "#000000";
    this.ctx.fillStyle = "#000000";
    this.ctx.globalAlpha = 0.12;
    this.ctx.lineWidth = 1 / zoom;

    if (this.background === "line") {
      const spacing = 32;
      const startX = Math.floor(left / spacing) * spacing;
      const endX = Math.ceil(right / spacing) * spacing;
      const startY = Math.floor(top / spacing) * spacing;
      const endY = Math.ceil(bottom / spacing) * spacing;

      for (let x = startX; x <= endX; x += spacing) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, top);
        this.ctx.lineTo(x, bottom);
        this.ctx.stroke();
      }

      for (let y = startY; y <= endY; y += spacing) {
        this.ctx.beginPath();
        this.ctx.moveTo(left, y);
        this.ctx.lineTo(right, y);
        this.ctx.stroke();
      }
    }

    if (this.background === "dot") {
      const spacing = 28;
      const startX = Math.floor(left / spacing) * spacing;
      const endX = Math.ceil(right / spacing) * spacing;
      const startY = Math.floor(top / spacing) * spacing;
      const endY = Math.ceil(bottom / spacing) * spacing;

      for (let x = startX; x <= endX; x += spacing) {
        for (let y = startY; y <= endY; y += spacing) {
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.25 / zoom, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
  };

  CanvasEngine.prototype.render = function () {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.renderBackground(width, height);

    this.ctx.save();
    this.ctx.translate(this.camera.x, this.camera.y);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);

    const strokes = this.draftStroke ? this.strokes.concat(this.draftStroke) : this.strokes;
    strokes.forEach(function (stroke) {
      if (stroke.tool === "pen") {
        drawPenStroke(this.ctx, stroke);
      } else if (stroke.tool === "line") {
        drawLineStroke(this.ctx, stroke);
      } else if (stroke.tool === "rect") {
        drawRectStroke(this.ctx, stroke);
      } else if (stroke.tool === "ellipse") {
        drawEllipseStroke(this.ctx, stroke);
      } else if (stroke.tool === "arrow") {
        drawArrowStroke(this.ctx, stroke);
      } else if (stroke.tool === "text") {
        drawTextStroke(this.ctx, stroke);
      } else if (stroke.tool === "eraser") {
        drawEraserStroke(this.ctx, stroke);
      }
    }, this);

    this.ctx.restore();
  };

  window.addEventListener("load", function () {
    const engine = new CanvasEngine();
    engine.init().catch(function () {
      engine.setSaveStatus("Init failed");
    });
  });
})();
