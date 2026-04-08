(function () {
  const MAX_POINTS = 500;
  const DB_NAME = "slateboard-phase1";
  const STORE_NAME = "boards";
  const BOARD_KEY = "local-board";
  const HISTORY_KEY = "slateboard.phase1.history";
  const LASER_FADE_MS = 550;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
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
    const baseline = distance(first, last) || 1;

    for (let i = 1; i < points.length - 1; i += 1) {
      const point = points[i];
      const numerator = Math.abs(
        (last.y - first.y) * point.x -
          (last.x - first.x) * point.y +
          last.x * first.y -
          last.y * first.x,
      );
      const offset = numerator / baseline;

      if (offset > maxDistance) {
        maxDistance = offset;
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

  function randomId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }

    return String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function createStroke(tool, style) {
    return {
      id: randomId(),
      tool: tool,
      style: {
        color: style.color,
        width: Number(style.width),
        opacity: Number(style.opacity),
        fill: Boolean(style.fill),
        pattern: style.pattern || "solid",
        textSize: Number(style.textSize || 24),
        arrowHead: Number(style.arrowHead || 18),
      },
      text: "",
      points: [],
      createdAt: Date.now(),
    };
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

  function setStrokeEndpoint(stroke, point) {
    if (stroke.points.length < 2) {
      stroke.points = stroke.points.length === 0 ? [point, point] : [stroke.points[0], point];
      return;
    }

    stroke.points[stroke.points.length - 1] = point;
  }

  function getDashPattern(style) {
    if (style.pattern === "dashed") {
      return [style.width * 2.5, style.width * 1.6];
    }

    if (style.pattern === "dotted") {
      return [style.width * 0.35, style.width * 1.35];
    }

    return [];
  }

  function applyStrokeStyle(ctx, style) {
    ctx.lineWidth = style.width;
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(getDashPattern(style));
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

  function drawSmoothPen(ctx, stroke, blendMode) {
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
    ctx.globalCompositeOperation = blendMode || "source-over";

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

  function drawPathStroke(ctx, stroke, blendMode) {
    if (!stroke || stroke.points.length === 0) {
      return;
    }

    ctx.save();
    applyStrokeStyle(ctx, stroke.style);
    ctx.globalCompositeOperation = blendMode || "source-over";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLine(ctx, stroke) {
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

  function drawRect(ctx, stroke) {
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

  function drawEllipse(ctx, stroke) {
    if (stroke.points.length < 2) {
      return;
    }

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.max(Math.abs(end.x - start.x) / 2, 1);
    const radiusY = Math.max(Math.abs(end.y - start.y) / 2, 1);

    ctx.save();
    applyStrokeStyle(ctx, stroke.style);
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    if (stroke.style.fill) {
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawArrow(ctx, stroke) {
    if (stroke.points.length < 2) {
      return;
    }

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(stroke.style.arrowHead, 8);
    const leftX = end.x - head * Math.cos(angle - Math.PI / 6);
    const leftY = end.y - head * Math.sin(angle - Math.PI / 6);
    const rightX = end.x - head * Math.cos(angle + Math.PI / 6);
    const rightY = end.y - head * Math.sin(angle + Math.PI / 6);

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

  function drawText(ctx, stroke) {
    if (!stroke.text || stroke.points.length === 0) {
      return;
    }

    ctx.save();
    ctx.fillStyle = stroke.style.color;
    ctx.globalAlpha = stroke.style.opacity;
    ctx.font = "900 " + Math.max(stroke.style.textSize, 12) + "px Space Grotesk, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(stroke.text, stroke.points[0].x, stroke.points[0].y);
    ctx.restore();
  }

  function pointToSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return distance(point, start);
    }

    let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    t = clamp(t, 0, 1);
    return distance(point, {
      x: start.x + t * dx,
      y: start.y + t * dy,
    });
  }

  function distanceToStroke(point, stroke) {
    if (!stroke || !stroke.points || stroke.points.length === 0) {
      return Infinity;
    }

    if (stroke.tool === "text") {
      return distance(point, stroke.points[0]);
    }

    let min = Infinity;
    for (let i = 0; i < stroke.points.length - 1; i += 1) {
      min = Math.min(min, pointToSegmentDistance(point, stroke.points[i], stroke.points[i + 1]));
    }
    return min;
  }

  function getTrailBounds(points, padding) {
    if (!points || points.length === 0) {
      return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < points.length; i += 1) {
      minX = Math.min(minX, points[i].x);
      minY = Math.min(minY, points[i].y);
      maxX = Math.max(maxX, points[i].x);
      maxY = Math.max(maxY, points[i].y);
    }

    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(maxX - minX + padding * 2, 1),
      height: Math.max(maxY - minY + padding * 2, 1),
    };
  }

  function createAddStrokeCommand(stroke) {
    const payload = { stroke: deepClone(stroke) };
    return {
      type: "add-stroke",
      payload: payload,
      apply: function (target) {
        target.addStroke(deepClone(payload.stroke));
      },
      revert: function (target) {
        target.removeStroke(payload.stroke.id);
      },
    };
  }

  function createRemoveStrokeCommand(stroke) {
    const payload = { stroke: deepClone(stroke) };
    return {
      type: "remove-stroke",
      payload: payload,
      apply: function (target) {
        target.removeStroke(payload.stroke.id);
      },
      revert: function (target) {
        target.addStroke(deepClone(payload.stroke));
      },
    };
  }

  function createUpdateStrokesCommand(beforeStrokes, afterStrokes) {
    const before = deepClone(beforeStrokes);
    const after = deepClone(afterStrokes);

    return {
      type: "update-strokes",
      payload: {
        before: before,
        after: after,
      },
      apply: function (target) {
        target.replaceStrokes(after);
      },
      revert: function (target) {
        target.replaceStrokes(before);
      },
    };
  }

  function createReplaceSceneCommand(beforeStrokes, afterStrokes) {
    const before = deepClone(beforeStrokes);
    const after = deepClone(afterStrokes);
    return {
      type: "replace-scene",
      payload: {
        before: before,
        after: after,
      },
      apply: function (target) {
        target.replaceAllStrokes(after);
      },
      revert: function (target) {
        target.replaceAllStrokes(before);
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
    if (!record) {
      return null;
    }

    if (record.type === "add-stroke") {
      return createAddStrokeCommand(record.payload.stroke);
    }

    if (record.type === "remove-stroke") {
      return createRemoveStrokeCommand(record.payload.stroke);
    }

    if (record.type === "update-strokes") {
      return createUpdateStrokesCommand(record.payload.before, record.payload.after);
    }

    if (record.type === "replace-scene") {
      return createReplaceSceneCommand(record.payload.before, record.payload.after);
    }

    return null;
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
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        past: this.past.map(serializeCommand),
        future: this.future.map(serializeCommand),
      }),
    );
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
    select: {
      button: "Select",
      title: "Selection",
      help: "Drag to select. Drag inside selection to move. Use handles to scale and rotate.",
      cursor: "default",
      mode: "select",
    },
    pan: {
      button: "Pan",
      title: "Pan",
      help: "Drag to move around the infinite board without holding space.",
      cursor: "grab",
      mode: "pan",
    },
    pen: {
      button: "Pen",
      title: "Pen",
      help: "Draw freehand strokes. Use stroke type for solid, dashed, or dotted marks.",
      cursor: "crosshair",
      mode: "draw",
    },
    highlight: {
      button: "Mark",
      title: "Highlighter",
      help: "Draw translucent highlight marks that sit above the board.",
      cursor: "crosshair",
      mode: "draw",
    },
    line: {
      button: "Line",
      title: "Line",
      help: "Drag to place a straight line.",
      cursor: "crosshair",
      mode: "shape",
    },
    rect: {
      button: "Rect",
      title: "Rectangle",
      help: "Drag to create a rectangle. Fill can be toggled on and off.",
      cursor: "crosshair",
      mode: "shape",
    },
    ellipse: {
      button: "Ellipse",
      title: "Ellipse",
      help: "Drag to create an ellipse. Fill can be toggled on and off.",
      cursor: "crosshair",
      mode: "shape",
    },
    arrow: {
      button: "Arrow",
      title: "Arrow",
      help: "Drag to place an arrow with a configurable arrow head.",
      cursor: "crosshair",
      mode: "shape",
    },
    text: {
      button: "Text",
      title: "Text",
      help: "Click anywhere on the board to place a text label.",
      cursor: "text",
      mode: "text",
    },
    eraser: {
      button: "Erase",
      title: "Eraser",
      help: "Drag a sweep box across the canvas to remove every touched element.",
      cursor: "cell",
      mode: "erase",
    },
    laser: {
      button: "Laser",
      title: "Laser pointer",
      help: "Hold and drag to point temporarily without leaving a saved mark.",
      cursor: "crosshair",
      mode: "laser",
    },
  };

  function CanvasEngine() {
    this.shell = document.querySelector(".board-shell");
    this.canvas = document.getElementById("board-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.saveStatus = document.getElementById("save-status");
    this.boardModeLabel = document.getElementById("board-mode-label");
    this.roomKeyLabel = document.getElementById("room-key");
    this.zoomIndicator = document.getElementById("zoom-indicator");
    this.widthInput = document.getElementById("stroke-width");
    this.widthValue = document.getElementById("stroke-width-value");
    this.opacityInput = document.getElementById("stroke-opacity");
    this.opacityValue = document.getElementById("stroke-opacity-value");
    this.fillToggle = document.getElementById("fill-toggle");
    this.strokePattern = document.getElementById("stroke-pattern");
    this.textSizeInput = document.getElementById("text-size");
    this.textSizeValue = document.getElementById("text-size-value");
    this.arrowHeadInput = document.getElementById("arrow-head");
    this.arrowHeadValue = document.getElementById("arrow-head-value");
    this.undoButton = document.getElementById("undo-button");
    this.redoButton = document.getElementById("redo-button");
    this.fitButton = document.getElementById("fit-button");
    this.exportToggle = document.getElementById("export-toggle");
    this.exportClose = document.getElementById("export-close");
    this.exportPanel = document.getElementById("export-panel");
    this.shareToggle = document.getElementById("share-toggle");
    this.shareClose = document.getElementById("share-close");
    this.sharePanel = document.getElementById("share-panel");
    this.shareRoomKey = document.getElementById("share-room-key");
    this.shareUrl = document.getElementById("share-url");
    this.shareDefaultRole = document.getElementById("share-default-role");
    this.copyRoomButton = document.getElementById("copy-room-button");
    this.copyShareButton = document.getElementById("copy-share-button");
    this.updateShareButton = document.getElementById("update-share-button");
    this.collaboratorList = document.getElementById("collaborator-list");
    this.presenceStrip = document.getElementById("presence-strip");
    this.toastStack = document.getElementById("toast-stack");
    this.exportFilename = document.getElementById("export-filename");
    this.exportIncludeBackground = document.getElementById("export-include-background");
    this.exportPngButton = document.getElementById("export-png-button");
    this.exportPngFullButton = document.getElementById("export-png-full-button");
    this.exportSvgButton = document.getElementById("export-svg-button");
    this.zoomRange = document.getElementById("zoom-range");
    this.zoomInput = document.getElementById("zoom-input");
    this.zoomDock = document.getElementById("zoom-dock");
    this.zoomToggle = document.getElementById("zoom-toggle");
    this.zoomInButton = document.getElementById("zoom-in-button");
    this.zoomOutButton = document.getElementById("zoom-out-button");
    this.toolbarToggle = document.getElementById("toolbar-toggle");
    this.boardToggle = document.getElementById("board-toggle");
    this.toolbarClose = document.getElementById("toolbar-close");
    this.boardClose = document.getElementById("board-close");
    this.toolRail = document.getElementById("tool-rail");
    this.propertiesPanel = document.getElementById("properties-panel");
    this.boardPanel = document.getElementById("board-panel");
    this.propertiesClose = document.getElementById("properties-close");
    this.propertiesTitle = document.getElementById("properties-title");
    this.toolHelp = document.getElementById("tool-help");
    this.inlineTextEditor = document.getElementById("inline-text-editor");
    this.shortcutsModal = document.getElementById("shortcuts-modal");
    this.shortcutsClose = document.getElementById("shortcuts-close");
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
    this.boardOpen = false;
    this.exportOpen = false;
    this.shareOpen = false;
    this.zoomDockCollapsed = false;
    this.isPanning = false;
    this.isPointerDown = false;
    this.panStart = null;
    this.selectionIds = [];
    this.selectionBounds = null;
    this.selectionBox = null;
    this.selectionMode = null;
    this.selectionHandle = null;
    this.selectionSnapshot = null;
    this.pendingTextPoint = null;
    this.touchGesture = null;
    this.draftStroke = null;
    this.strokes = [];
    this.laserPoints = [];
    this.laserExpiresAt = 0;
    this.eraseTrailPoints = [];
    this.remoteCursors = {};
    this.collaborators = [];
    this.socket = null;
    this.roomKey = new URLSearchParams(window.location.search).get("roomKey");
    this.sessionUser = null;
    this.sessionToken = "";
    this.userRole = "editor";
    this.guestId = this.ensureGuestId();
    this.shouldRender = true;
    this.history = new HistoryManager(this);
    this.boardStore = new LocalBoardStore();
    this.currentStyle = {
      color: "#000000",
      width: Number(this.widthInput.value),
      opacity: Number(this.opacityInput.value),
      fill: false,
      pattern: "solid",
      textSize: Number(this.textSizeInput.value),
      arrowHead: Number(this.arrowHeadInput.value),
    };
    this.scheduleSave = this.boardStore.createSaver(
      this.createSnapshot.bind(this),
      this.setSaveStatus.bind(this),
    );
  }

  CanvasEngine.prototype.init = async function () {
    document.body.tabIndex = -1;
    this.bindUI();
    this.selectTool("pen");
    this.setToolbarOpen(false);
    this.setPropertiesOpen(false);
    this.setBoardOpen(false);
    this.setExportOpen(false);
    this.setShareOpen(false);
    this.toggleShortcuts(false);
    this.zoomDock.dataset.collapsed = "false";
    this.resizeCanvas();
    await this.restoreState();
    this.history.restore();
    await this.initializeSession();
    this.renderLoop();
  };

  CanvasEngine.prototype.ensureGuestId = function () {
    const key = "slateboard.guestId";
    let guestId = window.localStorage.getItem(key);
    if (!guestId) {
      guestId = "guest-" + randomId("local").slice(-8);
      window.localStorage.setItem(key, guestId);
    }
    return guestId;
  };

  CanvasEngine.prototype.initializeSession = async function () {
    this.roomKey = this.roomKey ? String(this.roomKey).toUpperCase() : "";
    this.roomKeyLabel.textContent = this.roomKey || "Local";
    this.boardModeLabel.textContent = this.roomKey ? "Shared board" : "Local board";
    this.shareRoomKey.value = this.roomKey || "Local board";
    this.shareUrl.value = this.roomKey ? window.location.origin + "/board.html?roomKey=" + this.roomKey : "";

    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      if (response.ok) {
        const payload = await response.json();
        this.sessionUser = payload.user;
        const refreshResponse = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (refreshResponse.ok) {
          const refreshPayload = await refreshResponse.json();
          this.sessionToken = refreshPayload.token || "";
        }
      }
    } catch (error) {
      this.sessionUser = null;
    }

    if (!this.roomKey || typeof window.io !== "function") {
      this.renderCollaborators();
      return;
    }

    this.connectSocket();
  };

  CanvasEngine.prototype.bindUI = function () {
    const engine = this;

    this.toolbarToggle.addEventListener("click", function () {
      engine.setToolbarOpen(!engine.toolbarOpen);
      if (engine.toolbarOpen) {
        engine.setBoardOpen(false);
      }
    });

    this.boardToggle.addEventListener("click", function () {
      engine.setBoardOpen(!engine.boardOpen);
      if (engine.boardOpen) {
        engine.setToolbarOpen(false);
        engine.setExportOpen(false);
      }
    });

    this.exportToggle.addEventListener("click", function () {
      engine.setExportOpen(!engine.exportOpen);
      if (engine.exportOpen) {
        engine.setToolbarOpen(false);
        engine.setBoardOpen(false);
        engine.setShareOpen(false);
      }
    });

    this.shareToggle.addEventListener("click", function () {
      engine.setShareOpen(!engine.shareOpen);
      if (engine.shareOpen) {
        engine.setToolbarOpen(false);
        engine.setBoardOpen(false);
        engine.setExportOpen(false);
      }
    });

    this.toolbarClose.addEventListener("click", function () {
      engine.setToolbarOpen(false);
    });

    this.boardClose.addEventListener("click", function () {
      engine.setBoardOpen(false);
    });

    this.exportClose.addEventListener("click", function () {
      engine.setExportOpen(false);
    });

    this.shareClose.addEventListener("click", function () {
      engine.setShareOpen(false);
    });

    this.propertiesClose.addEventListener("click", function () {
      engine.setPropertiesOpen(false);
    });

    this.toolButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        if (!engine.canCurrentUserDraw() && ["select", "pen", "highlight", "line", "rect", "ellipse", "arrow", "text", "eraser"].indexOf(button.dataset.tool) >= 0) {
          engine.showToast("Viewer cannot edit");
          return;
        }
        engine.selectTool(button.dataset.tool);
        engine.setToolbarOpen(false);
        engine.setBoardOpen(false);
        engine.setExportOpen(false);
        engine.setShareOpen(false);
        engine.setPropertiesOpen(
          button.dataset.tool !== "pan" && button.dataset.tool !== "laser" && button.dataset.tool !== "select",
        );
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

    this.strokePattern.addEventListener("change", function () {
      engine.currentStyle.pattern = engine.strokePattern.value;
    });

    this.textSizeInput.addEventListener("input", function () {
      engine.currentStyle.textSize = Number(engine.textSizeInput.value);
      engine.textSizeValue.textContent = engine.currentStyle.textSize + " px";
    });

    this.arrowHeadInput.addEventListener("input", function () {
      engine.currentStyle.arrowHead = Number(engine.arrowHeadInput.value);
      engine.arrowHeadValue.textContent = engine.currentStyle.arrowHead + " px";
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
      engine.fitToContent();
    });

    this.zoomToggle.addEventListener("click", function () {
      engine.zoomDockCollapsed = !engine.zoomDockCollapsed;
      engine.zoomDock.dataset.collapsed = String(engine.zoomDockCollapsed);
      engine.zoomToggle.textContent = engine.zoomDockCollapsed ? "Show" : "Hide";
    });

    this.zoomOutButton.addEventListener("click", function () {
      engine.setZoomFromUi(Number(engine.zoomInput.value) - 5);
    });

    this.zoomInButton.addEventListener("click", function () {
      engine.setZoomFromUi(Number(engine.zoomInput.value) + 5);
    });

    this.zoomRange.addEventListener("input", function () {
      engine.setZoomFromUi(Number(engine.zoomRange.value));
    });

    this.zoomInput.addEventListener("change", function () {
      engine.setZoomFromUi(Number(engine.zoomInput.value));
    });

    this.exportPngButton.addEventListener("click", function () {
      engine.exportPng(false);
    });

    this.exportPngFullButton.addEventListener("click", function () {
      engine.exportPng(true);
    });

    this.exportSvgButton.addEventListener("click", function () {
      engine.exportSvg();
    });

    this.copyRoomButton.addEventListener("click", function () {
      engine.copyText(engine.shareRoomKey.value, "Room key copied");
    });

    this.copyShareButton.addEventListener("click", function () {
      engine.copyText(engine.shareUrl.value, "Share link copied");
    });

    this.updateShareButton.addEventListener("click", function () {
      engine.updateInvite();
    });

    this.shortcutsClose.addEventListener("click", function () {
      engine.toggleShortcuts(false);
    });

    this.inlineTextEditor.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        engine.commitInlineText();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        engine.cancelInlineText();
      }
    });

    this.inlineTextEditor.addEventListener("blur", function () {
      window.setTimeout(function () {
        engine.commitInlineText();
      }, 0);
    });

    window.addEventListener("resize", function () {
      engine.resizeCanvas();
    });

    document.body.addEventListener("pointerdown", function () {
      if (document.activeElement !== engine.inlineTextEditor) {
        document.body.focus();
      }
    });

    window.addEventListener("keydown", function (event) {
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

      if (event.key === "?") {
        event.preventDefault();
        engine.toggleShortcuts(true);
      }

      if ((event.key === "Delete" || event.key === "Backspace") && engine.selectionIds.length > 0 && engine.canCurrentUserDraw()) {
        event.preventDefault();
        engine.deleteSelection();
      }

      if (engine.canCurrentUserDraw() && engine.selectionIds.length > 0 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(event.key) >= 0) {
        event.preventDefault();
        engine.nudgeSelection(event.key, event.shiftKey ? 10 : 1);
      }

      if (event.key === "Escape") {
        engine.cancelInlineText();
        engine.setToolbarOpen(false);
        engine.setPropertiesOpen(false);
        engine.setBoardOpen(false);
        engine.setExportOpen(false);
        engine.setShareOpen(false);
        engine.toggleShortcuts(false);
      }
    });

    this.canvas.addEventListener(
      "wheel",
      function (event) {
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
        const zoom = clamp(engine.camera.zoom * factor, 0.25, 4);
        engine.camera.x = screenX - worldX * zoom;
        engine.camera.y = screenY - worldY * zoom;
        engine.camera.zoom = zoom;
        engine.syncZoomUi();
        engine.afterStateChange();
      },
      { passive: false },
    );

    this.canvas.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length === 2) {
          event.preventDefault();
          engine.startTouchGesture(event.touches);
        }
      },
      { passive: false },
    );

    this.canvas.addEventListener(
      "touchmove",
      function (event) {
        if (event.touches.length === 2) {
          event.preventDefault();
          engine.updateTouchGesture(event.touches);
        }
      },
      { passive: false },
    );

    this.canvas.addEventListener(
      "touchend",
      function () {
        engine.endTouchGesture();
      },
      { passive: false },
    );

    this.canvas.addEventListener("pointerdown", function (event) {
      const initialPoint = engine.getWorldPoint(event);
      engine.emitCursorMove(initialPoint);

      if (!engine.canCurrentUserDraw() && ["select", "pen", "highlight", "line", "rect", "ellipse", "arrow", "text", "eraser"].indexOf(engine.activeTool) >= 0) {
        engine.showToast("Viewer cannot draw");
        return;
      }

      if (event.button === 1 || engine.activeTool === "pan") {
        engine.startPan(event);
        return;
      }

      if (event.button !== 0) {
        return;
      }

      if (engine.activeTool === "select") {
        engine.beginSelectionPointer(event);
        return;
      }

      if (engine.activeTool === "laser") {
        engine.startLaser(event);
        return;
      }

      if (engine.activeTool === "text") {
        engine.openInlineTextEditor(event);
        return;
      }

      if (engine.activeTool === "eraser") {
        engine.beginSelectionPointer(event, true);
        return;
      }

      engine.canvas.setPointerCapture(event.pointerId);
      engine.isPointerDown = true;
      const point = engine.getWorldPoint(event);
      engine.draftStroke = createStroke(engine.activeTool, engine.styleForTool(engine.activeTool));

      if (engine.activeTool === "pen" || engine.activeTool === "highlight") {
        appendPointToStroke(engine.draftStroke, point);
      } else {
        engine.draftStroke.points = [point, point];
      }

      engine.broadcastStrokeStart(engine.draftStroke, point);
      engine.requestRender();
    });

    this.canvas.addEventListener("pointermove", function (event) {
      engine.emitCursorMove(engine.getWorldPoint(event));

      if (engine.isPanning) {
        engine.updatePan(event);
        return;
      }

      if (engine.activeTool === "laser" && engine.laserPoints.length > 0) {
        engine.updateLaser(event);
        return;
      }

      if (engine.activeTool === "select" || engine.activeTool === "eraser") {
        engine.updateSelectionPointer(event);
        return;
      }

      if (!engine.isPointerDown || !engine.draftStroke) {
        return;
      }

      const point = engine.getWorldPoint(event);
      if (engine.activeTool === "pen" || engine.activeTool === "highlight") {
        appendPointToStroke(engine.draftStroke, point);
      } else {
        setStrokeEndpoint(engine.draftStroke, point);
      }
      engine.broadcastStrokePoint(engine.draftStroke, point);
      engine.requestRender();
    });

    this.canvas.addEventListener("pointerup", function (event) {
      if (engine.isPanning) {
        engine.stopPan();
        return;
      }

      if (engine.activeTool === "laser" && engine.laserPoints.length > 0) {
        engine.stopLaser();
        return;
      }

      if (engine.activeTool === "select") {
        engine.endSelectionPointer(event);
        return;
      }

      if (engine.activeTool === "eraser") {
        engine.endSelectionPointer(event, true);
        return;
      }

      if (!engine.isPointerDown || !engine.draftStroke) {
        return;
      }

      const point = engine.getWorldPoint(event);
      if (engine.activeTool === "pen" || engine.activeTool === "highlight" || engine.activeTool === "eraser") {
        appendPointToStroke(engine.draftStroke, point);
      } else {
        setStrokeEndpoint(engine.draftStroke, point);
      }

      const finished = deepClone(engine.draftStroke);
      engine.draftStroke = null;
      engine.isPointerDown = false;
      engine.history.execute(createAddStrokeCommand(finished));
      engine.broadcastStrokeEnd(finished);
      engine.afterStateChange();
    });

    this.canvas.addEventListener("pointercancel", function () {
      engine.isPointerDown = false;
      engine.draftStroke = null;
      engine.selectionBox = null;
      engine.selectionMode = null;
      engine.stopPan();
      engine.stopLaser();
      engine.requestRender();
    });
  };

  CanvasEngine.prototype.styleForTool = function (toolName) {
    const style = deepClone(this.currentStyle);

    if (toolName === "highlight") {
      style.opacity = Math.min(style.opacity, 0.28);
      style.width = Math.max(style.width, 16);
      style.pattern = "solid";
    }

    return style;
  };

  CanvasEngine.prototype.toggleShortcuts = function (isOpen) {
    this.shortcutsModal.hidden = !isOpen;
    this.shortcutsModal.setAttribute("aria-hidden", String(!isOpen));
  };

  CanvasEngine.prototype.openInlineTextEditor = function (event) {
    this.cancelInlineText();
    const point = this.getWorldPoint(event);
    const screenX = point.x * this.camera.zoom + this.camera.x;
    const screenY = point.y * this.camera.zoom + this.camera.y;
    this.pendingTextPoint = point;
    this.inlineTextEditor.hidden = false;
    this.inlineTextEditor.value = "";
    this.inlineTextEditor.style.left = screenX + "px";
    this.inlineTextEditor.style.top = screenY + "px";
    this.inlineTextEditor.style.fontSize = Math.max(this.currentStyle.textSize, 12) + "px";
    window.setTimeout(
      function () {
        this.inlineTextEditor.focus();
      }.bind(this),
      0,
    );
  };

  CanvasEngine.prototype.commitInlineText = function () {
    if (this.inlineTextEditor.hidden || !this.pendingTextPoint) {
      return;
    }

    const content = this.inlineTextEditor.value.trim();
    if (content) {
      const stroke = createStroke("text", this.currentStyle);
      stroke.text = content;
      stroke.points = [this.pendingTextPoint];
      this.history.execute(createAddStrokeCommand(stroke));
      this.afterStateChange();
    }

    this.cancelInlineText();
  };

  CanvasEngine.prototype.cancelInlineText = function () {
    this.pendingTextPoint = null;
    this.inlineTextEditor.hidden = true;
    this.inlineTextEditor.value = "";
    document.body.focus();
  };

  CanvasEngine.prototype.startTouchGesture = function (touches) {
    const first = touches[0];
    const second = touches[1];
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    this.touchGesture = {
      distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
      centerX: centerX,
      centerY: centerY,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      zoom: this.camera.zoom,
      worldX: this.screenToWorldX(centerX),
      worldY: this.screenToWorldY(centerY),
    };
  };

  CanvasEngine.prototype.updateTouchGesture = function (touches) {
    if (!this.touchGesture) {
      return;
    }

    const first = touches[0];
    const second = touches[1];
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    const distanceNow = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    const zoom = clamp(this.touchGesture.zoom * (distanceNow / this.touchGesture.distance), 0.25, 4);
    this.camera.zoom = zoom;
    this.camera.x = centerX - this.touchGesture.worldX * zoom;
    this.camera.y = centerY - this.touchGesture.worldY * zoom;
    this.syncZoomUi();
    this.requestRender();
  };

  CanvasEngine.prototype.endTouchGesture = function () {
    if (!this.touchGesture) {
      return;
    }

    this.touchGesture = null;
    this.afterStateChange();
  };

  CanvasEngine.prototype.getStrokeBounds = function (stroke) {
    if (!stroke || !stroke.points || stroke.points.length === 0) {
      return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < stroke.points.length; i += 1) {
      minX = Math.min(minX, stroke.points[i].x);
      minY = Math.min(minY, stroke.points[i].y);
      maxX = Math.max(maxX, stroke.points[i].x);
      maxY = Math.max(maxY, stroke.points[i].y);
    }

    const pad = Math.max(stroke.style.width || 1, 6) * 0.5;
    if (stroke.tool === "text") {
      maxX = minX + Math.max((stroke.text || "").length * (stroke.style.textSize || 24) * 0.62, 20);
      maxY = minY + Math.max((stroke.style.textSize || 24) * 1.25, 20);
    }

    return {
      x: minX - pad,
      y: minY - pad,
      width: Math.max(maxX - minX + pad * 2, 1),
      height: Math.max(maxY - minY + pad * 2, 1),
    };
  };

  CanvasEngine.prototype.getSelectionBounds = function () {
    if (this.selectionIds.length === 0) {
      return null;
    }

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (let i = 0; i < this.strokes.length; i += 1) {
      if (this.selectionIds.indexOf(this.strokes[i].id) === -1) {
        continue;
      }

      const bounds = this.getStrokeBounds(this.strokes[i]);
      if (!bounds) {
        continue;
      }

      left = Math.min(left, bounds.x);
      top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.width);
      bottom = Math.max(bottom, bounds.y + bounds.height);
    }

    if (left === Infinity) {
      return null;
    }

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  };

  CanvasEngine.prototype.getBoundsForStrokeIds = function (ids) {
    const previous = this.selectionIds;
    this.selectionIds = ids.slice();
    const bounds = this.getSelectionBounds();
    this.selectionIds = previous;
    return bounds;
  };

  CanvasEngine.prototype.getSelectionHandles = function (bounds) {
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;
    const midX = left + bounds.width / 2;
    const midY = top + bounds.height / 2;
    return {
      nw: { x: left, y: top },
      n: { x: midX, y: top },
      ne: { x: right, y: top },
      e: { x: right, y: midY },
      se: { x: right, y: bottom },
      s: { x: midX, y: bottom },
      sw: { x: left, y: bottom },
      w: { x: left, y: midY },
      rotate: { x: midX, y: top - 28 },
    };
  };

  CanvasEngine.prototype.hitSelectionHandle = function (point) {
    const bounds = this.selectionBounds || this.getSelectionBounds();
    if (!bounds) {
      return null;
    }

    const handles = this.getSelectionHandles(bounds);
    const threshold = 10 / this.camera.zoom;
    const names = Object.keys(handles);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (distance(point, handles[name]) <= threshold) {
        return name;
      }
    }

    return null;
  };

  CanvasEngine.prototype.pointInBounds = function (point, bounds) {
    return (
      bounds &&
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  };

  CanvasEngine.prototype.rectsIntersect = function (a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  };

  CanvasEngine.prototype.transformStroke = function (stroke, transformPoint, scaleX, scaleY) {
    const next = deepClone(stroke);
    next.points = next.points.map(transformPoint);
    if (next.tool === "text") {
      next.style.textSize = Math.max(12, Math.round((next.style.textSize || 24) * Math.max(scaleX, scaleY)));
    }
    if (next.tool === "arrow") {
      next.style.arrowHead = Math.max(8, Math.round((next.style.arrowHead || 18) * Math.max(scaleX, scaleY)));
    }
    next.style.width = Math.max(1, next.style.width * Math.max(Math.min(scaleX, scaleY), 0.1));
    return next;
  };

  CanvasEngine.prototype.replaceStrokes = function (nextStrokes) {
    const updatesById = {};
    for (let i = 0; i < nextStrokes.length; i += 1) {
      updatesById[nextStrokes[i].id] = nextStrokes[i];
    }

    this.strokes = this.strokes.map(function (stroke) {
      return updatesById[stroke.id] ? deepClone(updatesById[stroke.id]) : stroke;
    });
    this.selectionBounds = this.getSelectionBounds();
    this.requestRender();
  };

  CanvasEngine.prototype.replaceAllStrokes = function (nextStrokes) {
    this.strokes = deepClone(nextStrokes);
    this.selectionIds = this.selectionIds.filter(
      function (id) {
        return this.strokes.some(function (stroke) {
          return stroke.id === id;
        });
      }.bind(this),
    );
    this.selectionBounds = this.getSelectionBounds();
    this.requestRender();
  };

  CanvasEngine.prototype.beginSelectionPointer = function (event, isEraseSweep) {
    const point = this.getWorldPoint(event);

    if (isEraseSweep) {
      this.selectionMode = "erase-sweep";
      this.selectionBox = null;
      this.eraseTrailPoints = [point];
      this.selectionIds = [];
      this.selectionBounds = null;
      this.requestRender();
      return;
    }

    this.selectionBounds = this.getSelectionBounds();
    const handle = this.hitSelectionHandle(point);

    if (handle) {
      this.selectionMode = handle === "rotate" ? "rotate" : "scale";
      this.selectionHandle = handle;
      this.selectionSnapshot = deepClone(this.strokes.filter(function (stroke) {
        return this.selectionIds.indexOf(stroke.id) >= 0;
      }, this));
      this.selectionStartPoint = point;
      return;
    }

    if (this.pointInBounds(point, this.selectionBounds)) {
      this.selectionMode = "move";
      this.selectionSnapshot = deepClone(this.strokes.filter(function (stroke) {
        return this.selectionIds.indexOf(stroke.id) >= 0;
      }, this));
      this.selectionStartPoint = point;
      return;
    }

    let nearestStroke = null;
    let nearestDistance = Infinity;
    for (let i = this.strokes.length - 1; i >= 0; i -= 1) {
      const candidateDistance = distanceToStroke(point, this.strokes[i]);
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        nearestStroke = this.strokes[i];
      }
    }

    if (nearestStroke && nearestDistance <= 10 / this.camera.zoom) {
      this.selectionIds = [nearestStroke.id];
      this.selectionBounds = this.getSelectionBounds();
      this.selectionMode = "move";
      this.selectionSnapshot = deepClone([nearestStroke]);
      this.selectionStartPoint = point;
      this.requestRender();
      return;
    }

    this.selectionMode = "marquee";
    this.selectionBox = {
      start: point,
      end: point,
    };
    this.selectionIds = [];
    this.selectionBounds = null;
    this.requestRender();
  };

  CanvasEngine.prototype.applySelectionTransform = function (transformPoint, scaleX, scaleY) {
    const updated = this.selectionSnapshot.map(function (stroke) {
      return this.transformStroke(stroke, transformPoint, scaleX, scaleY);
    }, this);
    this.replaceStrokes(updated);
  };

  CanvasEngine.prototype.updateSelectionPointer = function (event) {
    const point = this.getWorldPoint(event);
    if (this.selectionMode === "erase-sweep") {
      this.eraseTrailPoints.push(point);
      if (this.eraseTrailPoints.length > 20) {
        this.eraseTrailPoints = this.eraseTrailPoints.slice(-20);
      }
      this.requestRender();
      return;
    }

    if (this.selectionMode === "marquee" && this.selectionBox) {
      this.selectionBox.end = point;
      this.requestRender();
      return;
    }

    if (!this.selectionSnapshot || !this.selectionBounds) {
      return;
    }

    const bounds = this.selectionBounds;
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };

    if (this.selectionMode === "move") {
      const dx = point.x - this.selectionStartPoint.x;
      const dy = point.y - this.selectionStartPoint.y;
      this.applySelectionTransform(function (p) {
        return { x: p.x + dx, y: p.y + dy, pressure: p.pressure, t: p.t };
      }, 1, 1);
      return;
    }

    if (this.selectionMode === "rotate") {
      const startAngle = Math.atan2(this.selectionStartPoint.y - center.y, this.selectionStartPoint.x - center.x);
      const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
      const delta = currentAngle - startAngle;
      this.applySelectionTransform(function (p) {
        const x = p.x - center.x;
        const y = p.y - center.y;
        return {
          x: center.x + x * Math.cos(delta) - y * Math.sin(delta),
          y: center.y + x * Math.sin(delta) + y * Math.cos(delta),
          pressure: p.pressure,
          t: p.t,
        };
      }, 1, 1);
      return;
    }

    if (this.selectionMode === "scale") {
      const opposite = {
        nw: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        n: { x: center.x, y: bounds.y + bounds.height },
        ne: { x: bounds.x, y: bounds.y + bounds.height },
        e: { x: bounds.x, y: center.y },
        se: { x: bounds.x, y: bounds.y },
        s: { x: center.x, y: bounds.y },
        sw: { x: bounds.x + bounds.width, y: bounds.y },
        w: { x: bounds.x + bounds.width, y: center.y },
      }[this.selectionHandle];

      const scaleX = this.selectionHandle === "n" || this.selectionHandle === "s"
        ? 1
        : clamp((point.x - opposite.x) / (this.selectionStartPoint.x - opposite.x || 1), 0.1, 10);
      const scaleY = this.selectionHandle === "e" || this.selectionHandle === "w"
        ? 1
        : clamp((point.y - opposite.y) / (this.selectionStartPoint.y - opposite.y || 1), 0.1, 10);

      this.applySelectionTransform(function (p) {
        return {
          x: opposite.x + (p.x - opposite.x) * scaleX,
          y: opposite.y + (p.y - opposite.y) * scaleY,
          pressure: p.pressure,
          t: p.t,
        };
      }, Math.abs(scaleX), Math.abs(scaleY));
    }
  };

  CanvasEngine.prototype.endSelectionPointer = function (event, isEraseSweep) {
    if (isEraseSweep || this.selectionMode === "erase-sweep") {
      const threshold = Math.max(14 / this.camera.zoom, this.currentStyle.width * 1.6, 12);
      const trailBounds = getTrailBounds(this.eraseTrailPoints, threshold);
      const hitIds = this.strokes
        .filter(function (stroke) {
          const bounds = this.getStrokeBounds(stroke);
          if (!bounds || !trailBounds || !this.rectsIntersect(trailBounds, bounds)) {
            return false;
          }

          for (let i = 0; i < this.eraseTrailPoints.length; i += 1) {
            if (distanceToStroke(this.eraseTrailPoints[i], stroke) <= threshold) {
              return true;
            }
          }

          return false;
        }, this)
        .map(function (stroke) {
          return stroke.id;
        });

      if (hitIds.length > 0) {
        const before = deepClone(this.strokes);
        const after = this.strokes.filter(function (stroke) {
          return hitIds.indexOf(stroke.id) === -1;
        });
        this.history.execute(createReplaceSceneCommand(before, after));
        this.broadcastDelete(hitIds);
        this.afterStateChange();
      } else {
        this.requestRender();
      }

      this.selectionIds = [];
      this.selectionBounds = null;
    } else if (this.selectionMode === "marquee" && this.selectionBox) {
      const x = Math.min(this.selectionBox.start.x, this.selectionBox.end.x);
      const y = Math.min(this.selectionBox.start.y, this.selectionBox.end.y);
      const width = Math.max(Math.abs(this.selectionBox.end.x - this.selectionBox.start.x), 14 / this.camera.zoom);
      const height = Math.max(Math.abs(this.selectionBox.end.y - this.selectionBox.start.y), 14 / this.camera.zoom);
      const rect = { x: x, y: y, width: width, height: height };
      this.selectionIds = this.strokes
        .filter(function (stroke) {
          const bounds = this.getStrokeBounds(stroke);
          return bounds && this.rectsIntersect(rect, bounds);
        }, this)
        .map(function (stroke) {
          return stroke.id;
        });
      this.selectionBounds = this.getSelectionBounds();
    } else if (this.selectionMode === "move" || this.selectionMode === "scale" || this.selectionMode === "rotate") {
      if (this.selectionSnapshot) {
        const before = this.selectionSnapshot;
        const after = this.strokes.filter(function (stroke) {
          return this.selectionIds.indexOf(stroke.id) >= 0;
        }, this);
        this.history.execute(createUpdateStrokesCommand(before, after));
      }
      this.selectionBounds = this.getSelectionBounds();
    }

    this.selectionBox = null;
    this.selectionMode = null;
    this.selectionHandle = null;
    this.selectionSnapshot = null;
    this.eraseTrailPoints = [];
    this.requestRender();
  };

  CanvasEngine.prototype.deleteSelection = function () {
    const targets = this.strokes.filter(function (stroke) {
      return this.selectionIds.indexOf(stroke.id) >= 0;
    }, this);
    const deletedIds = [];

    for (let i = 0; i < targets.length; i += 1) {
      deletedIds.push(targets[i].id);
      this.history.execute(createRemoveStrokeCommand(targets[i]));
    }

    this.selectionIds = [];
    this.selectionBounds = null;
    this.broadcastDelete(deletedIds);
    this.afterStateChange();
  };

  CanvasEngine.prototype.nudgeSelection = function (key, step) {
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    const before = deepClone(this.strokes.filter(function (stroke) {
      return this.selectionIds.indexOf(stroke.id) >= 0;
    }, this));
    const after = before.map(function (stroke) {
      return this.transformStroke(stroke, function (p) {
        return { x: p.x + dx, y: p.y + dy, pressure: p.pressure, t: p.t };
      }, 1, 1);
    }, this);
    this.replaceStrokes(after);
    this.history.execute(createUpdateStrokesCommand(before, after));
    this.afterStateChange();
  };

  CanvasEngine.prototype.fitToContent = function () {
    let bounds = null;
    for (let i = 0; i < this.strokes.length; i += 1) {
      const strokeBounds = this.getStrokeBounds(this.strokes[i]);
      if (!strokeBounds) {
        continue;
      }

      if (!bounds) {
        bounds = deepClone(strokeBounds);
      } else {
        const right = Math.max(bounds.x + bounds.width, strokeBounds.x + strokeBounds.width);
        const bottom = Math.max(bounds.y + bounds.height, strokeBounds.y + strokeBounds.height);
        bounds.x = Math.min(bounds.x, strokeBounds.x);
        bounds.y = Math.min(bounds.y, strokeBounds.y);
        bounds.width = right - bounds.x;
        bounds.height = bottom - bounds.y;
      }
    }

    if (!bounds) {
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.syncZoomUi();
      this.afterStateChange();
      return;
    }

    const padding = 80;
    const zoom = clamp(
      Math.min(
        (this.viewport.width - padding * 2) / Math.max(bounds.width, 1),
        (this.viewport.height - padding * 2) / Math.max(bounds.height, 1),
      ),
      0.25,
      4,
    );
    this.camera.zoom = zoom;
    this.camera.x = this.viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom;
    this.camera.y = this.viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom;
    this.syncZoomUi();
    this.afterStateChange();
  };

  CanvasEngine.prototype.exportPng = function (fullContent) {
    const fileName = (this.exportFilename.value || "slateboard-board").trim() || "slateboard-board";
    const includeBackground = this.exportIncludeBackground.checked;
    if (!fullContent) {
      const link = document.createElement("a");
      link.href = this.canvas.toDataURL("image/png");
      link.download = fileName + ".png";
      link.click();
      return;
    }

    let bounds = this.getBoundsForStrokeIds(this.strokes.map(function (stroke) { return stroke.id; }));
    if (!bounds) {
      this.exportPng(false);
      return;
    }

    const temp = document.createElement("canvas");
    temp.width = Math.ceil(bounds.width + 120);
    temp.height = Math.ceil(bounds.height + 120);
    const ctx = temp.getContext("2d");
    if (includeBackground) {
      ctx.fillStyle = this.background === "white" ? "#ffffff" : "#fffdf5";
      ctx.fillRect(0, 0, temp.width, temp.height);
    }
    ctx.save();
    ctx.translate(60 - bounds.x, 60 - bounds.y);
    for (let i = 0; i < this.strokes.length; i += 1) {
      this.renderStrokeOnContext(ctx, this.strokes[i]);
    }
    ctx.restore();
    const link = document.createElement("a");
    link.href = temp.toDataURL("image/png");
    link.download = fileName + "-full.png";
    link.click();
  };

  CanvasEngine.prototype.renderStrokeOnContext = function (ctx, stroke) {
    const previous = this.ctx;
    this.ctx = ctx;
    this.renderStroke(stroke);
    this.ctx = previous;
  };

  CanvasEngine.prototype.exportSvg = function () {
    const fileName = (this.exportFilename.value || "slateboard-board").trim() || "slateboard-board";
    const includeBackground = this.exportIncludeBackground.checked;
    const width = this.viewport.width;
    const height = this.viewport.height;
    const parts = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height + '">',
    ];

    if (includeBackground) {
      parts.push('<rect width="100%" height="100%" fill="' + (this.background === "white" ? "#ffffff" : "#fffdf5") + '"/>');
      if (this.background === "line") {
        parts.push('<defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#000000" stroke-opacity="0.12" stroke-width="1"/></pattern></defs>');
        parts.push('<rect width="100%" height="100%" fill="url(#grid)"/>');
      } else if (this.background === "dot") {
        parts.push('<defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.25" fill="#000000" fill-opacity="0.12"/></pattern></defs>');
        parts.push('<rect width="100%" height="100%" fill="url(#dots)"/>');
      }
    }

    parts.push(
      '<g transform="translate(' + this.camera.x + " " + this.camera.y + ") scale(" + this.camera.zoom + ')">',
    );

    for (let i = 0; i < this.strokes.length; i += 1) {
      const stroke = this.strokes[i];
      if (stroke.tool === "eraser") {
        continue;
      }
      const dash = getDashPattern(stroke.style);
      const dashAttr = dash.length ? ' stroke-dasharray="' + dash.join(",") + '"' : "";
      if (stroke.tool === "text") {
        parts.push(
          '<text x="' + stroke.points[0].x + '" y="' + stroke.points[0].y + '" fill="' + stroke.style.color + '" fill-opacity="' +
            stroke.style.opacity + '" font-family="Space Grotesk" font-size="' + stroke.style.textSize + '" font-weight="900">' +
            stroke.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
          "</text>",
        );
      } else if (stroke.tool === "rect") {
        const start = stroke.points[0];
        const end = stroke.points[stroke.points.length - 1];
        parts.push('<rect x="' + Math.min(start.x, end.x) + '" y="' + Math.min(start.y, end.y) + '" width="' +
          Math.abs(end.x - start.x) + '" height="' + Math.abs(end.y - start.y) + '" fill="' +
          (stroke.style.fill ? stroke.style.color : "none") + '" fill-opacity="' + stroke.style.opacity +
          '" stroke="' + stroke.style.color + '" stroke-width="' + stroke.style.width + '"' + dashAttr + '/>');
      } else if (stroke.tool === "ellipse") {
        const start = stroke.points[0];
        const end = stroke.points[stroke.points.length - 1];
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        parts.push('<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + Math.abs(end.x - start.x) / 2 + '" ry="' +
          Math.abs(end.y - start.y) / 2 + '" fill="' + (stroke.style.fill ? stroke.style.color : "none") + '" fill-opacity="' +
          stroke.style.opacity + '" stroke="' + stroke.style.color + '" stroke-width="' + stroke.style.width + '"' + dashAttr + '/>');
      } else {
        const path = stroke.points.map(function (point, index) {
          return (index === 0 ? "M" : "L") + point.x + " " + point.y;
        }).join(" ");
        parts.push('<path d="' + path + '" fill="none" stroke="' + stroke.style.color + '" stroke-opacity="' +
          stroke.style.opacity + '" stroke-width="' + stroke.style.width + '" stroke-linecap="round" stroke-linejoin="round"' + dashAttr + '/>');
      }
    }

    parts.push("</g></svg>");
    const blob = new Blob([parts.join("")], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName + ".svg";
    link.click();
    URL.revokeObjectURL(url);
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

  CanvasEngine.prototype.startLaser = function (event) {
    this.laserPoints = [this.getWorldPoint(event)];
    this.laserExpiresAt = Date.now() + LASER_FADE_MS;
    this.requestRender();
  };

  CanvasEngine.prototype.updateLaser = function (event) {
    this.laserPoints.push(this.getWorldPoint(event));
    if (this.laserPoints.length > 24) {
      this.laserPoints = this.laserPoints.slice(-24);
    }
    this.laserExpiresAt = Date.now() + LASER_FADE_MS;
    this.requestRender();
  };

  CanvasEngine.prototype.stopLaser = function () {
    if (this.laserPoints.length > 0) {
      this.laserExpiresAt = Date.now() + LASER_FADE_MS;
      this.requestRender();
    }
  };

  CanvasEngine.prototype.eraseElementAt = function (point) {
    let target = null;
    let bestDistance = Infinity;

    for (let i = this.strokes.length - 1; i >= 0; i -= 1) {
      const stroke = this.strokes[i];
      if (stroke.tool === "eraser") {
        continue;
      }

      const offset = distanceToStroke(point, stroke);
      if (offset < bestDistance) {
        bestDistance = offset;
        target = stroke;
      }
    }

    if (target && bestDistance <= Math.max(this.currentStyle.width * 2, 20)) {
      this.history.execute(createRemoveStrokeCommand(target));
      this.afterStateChange();
    }
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
    this.syncZoomUi();
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
    this.selectionIds = this.selectionIds.filter(function (id) {
      return id !== strokeId;
    });
    this.selectionBounds = this.getSelectionBounds();
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
    this.syncZoomUi();
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

  CanvasEngine.prototype.setBoardOpen = function (isOpen) {
    this.boardOpen = isOpen;
    this.boardToggle.setAttribute("aria-expanded", String(isOpen));
    this.boardPanel.hidden = !isOpen;
  };

  CanvasEngine.prototype.setExportOpen = function (isOpen) {
    this.exportOpen = isOpen;
    this.exportToggle.setAttribute("aria-expanded", String(isOpen));
    this.exportPanel.hidden = !isOpen;
  };

  CanvasEngine.prototype.setShareOpen = function (isOpen) {
    this.shareOpen = isOpen;
    this.shareToggle.setAttribute("aria-expanded", String(isOpen));
    this.sharePanel.hidden = !isOpen;
  };

  CanvasEngine.prototype.showToast = function (message) {
    if (!this.toastStack) {
      return;
    }

    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    this.toastStack.appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 2200);
  };

  CanvasEngine.prototype.copyText = function (value, successMessage) {
    if (!value) {
      return;
    }

    const engine = this;
    navigator.clipboard.writeText(value).then(function () {
      engine.showToast(successMessage);
    }).catch(function () {
      engine.showToast("Copy failed");
    });
  };

  CanvasEngine.prototype.updateInvite = async function () {
    if (!this.roomKey || !this.sessionUser) {
      this.showToast("Open a shared board as owner first");
      return;
    }

    try {
      const response = await fetch("/api/boards/" + encodeURIComponent(this.roomKey) + "/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          defaultRole: this.shareDefaultRole.value,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || "Invite update failed");
      }
      this.shareUrl.value = payload.inviteUrl;
      this.shareRoomKey.value = payload.roomKey;
      this.showToast("Invite updated");
    } catch (error) {
      this.showToast(error.message);
    }
  };

  CanvasEngine.prototype.renderCollaborators = function () {
    const collaborators = this.collaborators.slice();
    this.presenceStrip.innerHTML = "";
    this.collaboratorList.innerHTML = "";

    if (collaborators.length === 0) {
      return;
    }

    for (let i = 0; i < collaborators.length; i += 1) {
      const person = collaborators[i];
      const presence = document.createElement("div");
      presence.className = "presence-chip";
      presence.title = person.displayName + " • " + person.role;
      presence.innerHTML =
        '<span class="presence-dot" style="--presence-color:' + person.color + '"></span>' +
        '<span>' + (person.role === "owner" ? "Crown " : "") + person.displayName + '</span>';
      this.presenceStrip.appendChild(presence);

      const row = document.createElement("div");
      row.className = "collaborator-row";
      const canEditRole = this.userRole === "owner" && person.id !== this.sessionActorId();
      row.innerHTML =
        '<div class="collaborator-meta">' +
        '<span class="collaborator-name">' + person.displayName + '</span>' +
        '<span class="collaborator-subline">' + person.role + (person.guest ? " • guest" : "") + "</span>" +
        "</div>";

      if (canEditRole) {
        const select = document.createElement("select");
        select.className = "brutal-select collaborator-role";
        select.innerHTML = '<option value="viewer">Viewer</option><option value="editor">Editor</option>';
        select.value = person.role === "owner" ? "editor" : person.role;
        select.addEventListener("change", this.setRemoteRole.bind(this, person.id));
        row.appendChild(select);
      } else {
        const badge = document.createElement("div");
        badge.className = "status-badge";
        badge.textContent = person.role;
        row.appendChild(badge);
      }

      this.collaboratorList.appendChild(row);
    }
  };

  CanvasEngine.prototype.sessionActorId = function () {
    return this.sessionUser ? this.sessionUser.id : this.guestId;
  };

  CanvasEngine.prototype.canCurrentUserDraw = function () {
    return this.userRole !== "viewer";
  };

  CanvasEngine.prototype.setRemoteRole = function (targetUserId, event) {
    if (!this.socket) {
      return;
    }
    this.socket.emit("permission:set", {
      targetUserId: targetUserId,
      role: event.target.value,
    });
  };

  CanvasEngine.prototype.connectSocket = function () {
    const engine = this;
    this.socket = window.io({
      transports: ["websocket", "polling"],
    });

    this.socket.on("connect", function () {
      engine.socket.emit("board:join", {
        roomKey: engine.roomKey,
        token: engine.sessionToken,
        guestId: engine.guestId,
      });
    });

    this.socket.on("board:state", function (payload) {
      if (payload.board) {
        engine.boardModeLabel.textContent = "Shared board";
        engine.roomKeyLabel.textContent = payload.board.roomKey;
        engine.shareRoomKey.value = payload.board.roomKey;
        engine.shareUrl.value = window.location.origin + "/board.html?roomKey=" + payload.board.roomKey;
        engine.shareDefaultRole.value = payload.board.defaultRole || "editor";
        engine.background = payload.board.background || engine.background;
        engine.backgroundButtons.forEach(function (button) {
          button.classList.toggle("is-active", button.dataset.background === engine.background);
        });
      }
      engine.strokes = (payload.strokes || []).map(function (stroke) {
        return deepClone(stroke);
      });
      engine.collaborators = payload.collaborators || [];
      engine.renderCollaborators();
      engine.requestRender();
    });

    this.socket.on("stroke:remote", function (payload) {
      engine.applyRemoteStroke(payload);
    });

    this.socket.on("stroke:delete", function (payload) {
      const ids = (payload.strokeIds || []).map(String);
      engine.strokes = engine.strokes.filter(function (stroke) {
        return ids.indexOf(String(stroke.id || stroke.strokeId)) === -1;
      });
      engine.requestRender();
    });

    this.socket.on("cursor:remote", function (payload) {
      engine.remoteCursors[payload.userId] = Object.assign({ expiresAt: Date.now() + 1500 }, payload);
      engine.requestRender();
    });

    this.socket.on("permission:ack", function (payload) {
      if (payload.userId === engine.sessionActorId()) {
        engine.userRole = payload.newRole;
        if (engine.userRole === "viewer") {
          engine.showToast("Viewer mode");
          engine.selectTool("pan");
        } else {
          engine.showToast("Role updated to " + payload.newRole);
        }
      }
      for (let i = 0; i < engine.collaborators.length; i += 1) {
        if (engine.collaborators[i].id === payload.userId) {
          engine.collaborators[i].role = payload.newRole;
        }
      }
      engine.renderCollaborators();
    });

    this.socket.on("error", function (payload) {
      if (payload && payload.code === "DRAW_FORBIDDEN") {
        engine.showToast("Viewer cannot draw");
      } else if (payload && payload.message) {
        engine.showToast(payload.message);
      }
    });
  };

  CanvasEngine.prototype.applyRemoteStroke = function (payload) {
    if (!payload) {
      return;
    }

    const strokeId = payload.id || payload.strokeId;
    const existingIndex = this.strokes.findIndex(function (stroke) {
      return String(stroke.id || stroke.strokeId) === String(strokeId);
    });
    const normalized = {
      id: strokeId,
      strokeId: strokeId,
      tool: payload.tool,
      style: payload.style,
      points: deepClone(payload.points || []),
      text: payload.text || "",
      authorId: payload.authorId,
    };

    if (existingIndex >= 0) {
      this.strokes[existingIndex] = normalized;
    } else {
      this.strokes.push(normalized);
    }
    this.requestRender();
  };

  CanvasEngine.prototype.emitCursorMove = function (point) {
    if (!this.socket) {
      return;
    }

    const now = Date.now();
    if (this.lastCursorEmitAt && now - this.lastCursorEmitAt < 50) {
      return;
    }

    this.lastCursorEmitAt = now;
    this.socket.emit("cursor:move", {
      x: point.x,
      y: point.y,
    });
  };

  CanvasEngine.prototype.broadcastStrokeStart = function (stroke, point) {
    if (!this.socket || !this.roomKey || !this.canCurrentUserDraw()) {
      return;
    }
    this.socket.emit("stroke:start", {
      strokeId: stroke.id,
      tool: stroke.tool,
      style: stroke.style,
      startPoint: point,
    });
  };

  CanvasEngine.prototype.broadcastStrokePoint = function (stroke, point) {
    if (!this.socket || !this.roomKey || !this.canCurrentUserDraw()) {
      return;
    }
    this.socket.emit("stroke:point", {
      strokeId: stroke.id,
      point: point,
    });
  };

  CanvasEngine.prototype.broadcastStrokeEnd = function (stroke) {
    if (!this.socket || !this.roomKey || !this.canCurrentUserDraw()) {
      return;
    }
    this.socket.emit("stroke:end", {
      strokeId: stroke.id,
      finalPoints: stroke.points,
    });
  };

  CanvasEngine.prototype.broadcastDelete = function (ids) {
    if (!this.socket || !this.roomKey || !this.canCurrentUserDraw() || !ids || ids.length === 0) {
      return;
    }
    this.socket.emit("stroke:delete", {
      strokeIds: ids,
    });
  };

  CanvasEngine.prototype.syncZoomUi = function () {
    const zoom = Math.round(this.camera.zoom * 100);
    this.zoomIndicator.textContent = zoom + "%";
    this.zoomRange.value = String(zoom);
    this.zoomInput.value = String(zoom);
  };

  CanvasEngine.prototype.setZoomFromUi = function (value) {
    const zoom = clamp(value / 100, 0.25, 4);
    const centerWorldX = this.screenToWorldX(this.viewport.width / 2);
    const centerWorldY = this.screenToWorldY(this.viewport.height / 2);
    this.camera.zoom = zoom;
    this.camera.x = this.viewport.width / 2 - centerWorldX * zoom;
    this.camera.y = this.viewport.height / 2 - centerWorldY * zoom;
    this.syncZoomUi();
    this.afterStateChange();
  };

  CanvasEngine.prototype.updateElementControls = function (toolName) {
    this.strokePattern.closest(".panel-group").hidden =
      ["pen", "line", "rect", "ellipse", "arrow"].indexOf(toolName) === -1;
    this.fillToggle.closest(".panel-group").hidden = ["rect", "ellipse"].indexOf(toolName) === -1;
    this.textSizeInput.closest(".panel-group").hidden = toolName !== "text";
    this.arrowHeadInput.closest(".panel-group").hidden = toolName !== "arrow";
  };

  CanvasEngine.prototype.selectTool = function (toolName) {
    const meta = TOOL_META[toolName] || TOOL_META.pen;
    this.activeTool = toolName;
    this.toolbarToggle.textContent = meta.button;
    this.propertiesTitle.textContent = meta.title;
    this.toolHelp.textContent = meta.help;
    this.canvas.style.cursor = meta.cursor;
    this.strokePattern.value = this.currentStyle.pattern;
    this.fillToggle.checked = this.currentStyle.fill;
    this.textSizeInput.value = this.currentStyle.textSize;
    this.textSizeValue.textContent = this.currentStyle.textSize + " px";
    this.arrowHeadInput.value = this.currentStyle.arrowHead;
    this.arrowHeadValue.textContent = this.currentStyle.arrowHead + " px";
    this.updateElementControls(toolName);

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
      if (this.laserPoints.length > 0 || Object.keys(this.remoteCursors).length > 0) {
        this.render();
      }
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

    const left = this.screenToWorldX(0);
    const top = this.screenToWorldY(0);
    const right = this.screenToWorldX(width);
    const bottom = this.screenToWorldY(height);
    const zoom = this.camera.zoom;

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
    } else if (this.background === "dot") {
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

  CanvasEngine.prototype.renderLaser = function () {
    if (this.laserPoints.length === 0) {
      return;
    }

    const remaining = this.laserExpiresAt - Date.now();
    if (remaining <= 0) {
      this.laserPoints = [];
      return;
    }

    const alpha = clamp(remaining / LASER_FADE_MS, 0, 1);
    this.ctx.save();
    this.ctx.translate(this.camera.x, this.camera.y);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.strokeStyle = "#ff3b30";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    if (this.laserPoints.length > 1) {
      const trace = this.laserPoints;
      this.ctx.beginPath();
      this.ctx.moveTo(trace[0].x, trace[0].y);
      for (let i = 1; i < trace.length - 1; i += 1) {
        const midX = (trace[i].x + trace[i + 1].x) / 2;
        const midY = (trace[i].y + trace[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(trace[i].x, trace[i].y, midX, midY);
      }
      const last = trace[trace.length - 1];
      this.ctx.lineTo(last.x, last.y);
      this.ctx.globalAlpha = alpha * 0.2;
      this.ctx.lineWidth = 14 / this.camera.zoom;
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(trace[0].x, trace[0].y);
      for (let i = 1; i < trace.length - 1; i += 1) {
        const midX = (trace[i].x + trace[i + 1].x) / 2;
        const midY = (trace[i].y + trace[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(trace[i].x, trace[i].y, midX, midY);
      }
      this.ctx.lineTo(last.x, last.y);
      this.ctx.globalAlpha = alpha * 0.9;
      this.ctx.lineWidth = 5.5 / this.camera.zoom;
      this.ctx.stroke();
    }

    const tip = this.laserPoints[this.laserPoints.length - 1];
    this.ctx.beginPath();
    this.ctx.fillStyle = "#ff3b30";
    this.ctx.globalAlpha = alpha * 0.22;
    this.ctx.arc(tip.x, tip.y, 13 / this.camera.zoom, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.globalAlpha = alpha;
    this.ctx.arc(tip.x, tip.y, 5.5 / this.camera.zoom, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  };

  CanvasEngine.prototype.renderSelectionOverlay = function () {
    const bounds = this.getSelectionBounds();
    this.selectionBounds = bounds;

    if (this.selectionBox && this.selectionMode !== "erase-sweep") {
      const x = Math.min(this.selectionBox.start.x, this.selectionBox.end.x);
      const y = Math.min(this.selectionBox.start.y, this.selectionBox.end.y);
      const width = Math.abs(this.selectionBox.end.x - this.selectionBox.start.x);
      const height = Math.abs(this.selectionBox.end.y - this.selectionBox.start.y);
      this.ctx.save();
      this.ctx.strokeStyle = this.selectionMode === "erase-sweep" ? "#ff6b6b" : "#000000";
      this.ctx.lineWidth = 2 / this.camera.zoom;
      this.ctx.setLineDash([10 / this.camera.zoom, 8 / this.camera.zoom]);
      this.ctx.strokeRect(x, y, width, height);
      this.ctx.restore();
    }

    if (this.selectionMode === "erase-sweep" && this.eraseTrailPoints.length > 0) {
      this.ctx.save();
      this.ctx.strokeStyle = "#ff6b6b";
      this.ctx.fillStyle = "#ff6b6b";
      for (let i = 1; i < this.eraseTrailPoints.length; i += 1) {
        const from = this.eraseTrailPoints[i - 1];
        const to = this.eraseTrailPoints[i];
        const ratio = i / Math.max(this.eraseTrailPoints.length - 1, 1);
        this.ctx.beginPath();
        this.ctx.globalAlpha = 0.08 + ratio * 0.28;
        this.ctx.lineWidth = (4 + ratio * 8) / this.camera.zoom;
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(to.x, to.y);
        this.ctx.stroke();
      }

      const tip = this.eraseTrailPoints[this.eraseTrailPoints.length - 1];
      this.ctx.beginPath();
      this.ctx.globalAlpha = 0.95;
      this.ctx.arc(tip.x, tip.y, 10 / this.camera.zoom, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    if (!bounds || this.selectionIds.length === 0) {
      return;
    }

    const handles = this.getSelectionHandles(bounds);
    const names = Object.keys(handles);
    this.ctx.save();
    this.ctx.strokeStyle = "#000000";
    this.ctx.fillStyle = "#ffd93d";
    this.ctx.lineWidth = 2 / this.camera.zoom;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.ctx.beginPath();
    this.ctx.moveTo(bounds.x + bounds.width / 2, bounds.y);
    this.ctx.lineTo(handles.rotate.x, handles.rotate.y);
    this.ctx.stroke();

    for (let i = 0; i < names.length; i += 1) {
      const handle = handles[names[i]];
      this.ctx.beginPath();
      this.ctx.rect(handle.x - 5 / this.camera.zoom, handle.y - 5 / this.camera.zoom, 10 / this.camera.zoom, 10 / this.camera.zoom);
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
  };

  CanvasEngine.prototype.renderRemoteCursors = function () {
    const ids = Object.keys(this.remoteCursors);
    if (ids.length === 0) {
      return;
    }

    const now = Date.now();
    for (let i = 0; i < ids.length; i += 1) {
      const cursor = this.remoteCursors[ids[i]];
      if (!cursor || cursor.expiresAt < now) {
        delete this.remoteCursors[ids[i]];
        continue;
      }

      const screenX = cursor.x * this.camera.zoom + this.camera.x;
      const screenY = cursor.y * this.camera.zoom + this.camera.y;
      this.ctx.save();
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.translate(screenX, screenY);
      this.ctx.fillStyle = cursor.color || "#FF6B6B";
      this.ctx.strokeStyle = "#000000";
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(0, 0);
      this.ctx.lineTo(12, 22);
      this.ctx.lineTo(4, 19);
      this.ctx.lineTo(-1, 28);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(16, -10, Math.max((cursor.displayName || "Guest").length * 9, 62), 26);
      this.ctx.strokeRect(16, -10, Math.max((cursor.displayName || "Guest").length * 9, 62), 26);
      this.ctx.fillStyle = "#000000";
      this.ctx.font = "900 12px Space Grotesk, sans-serif";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(cursor.displayName || "Guest", 24, 3);
      this.ctx.restore();
    }
  };

  CanvasEngine.prototype.renderStroke = function (stroke) {
    if (stroke.tool === "pen") {
      if (stroke.style.pattern === "solid") {
        drawSmoothPen(this.ctx, stroke);
      } else {
        drawPathStroke(this.ctx, stroke);
      }
    } else if (stroke.tool === "highlight") {
      drawPathStroke(this.ctx, stroke);
    } else if (stroke.tool === "line") {
      drawLine(this.ctx, stroke);
    } else if (stroke.tool === "rect") {
      drawRect(this.ctx, stroke);
    } else if (stroke.tool === "ellipse") {
      drawEllipse(this.ctx, stroke);
    } else if (stroke.tool === "arrow") {
      drawArrow(this.ctx, stroke);
    } else if (stroke.tool === "text") {
      drawText(this.ctx, stroke);
    } else if (stroke.tool === "eraser") {
      drawPathStroke(this.ctx, stroke, "destination-out");
    }
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
    for (let i = 0; i < strokes.length; i += 1) {
      this.renderStroke(strokes[i]);
    }

    this.renderSelectionOverlay();

    this.ctx.restore();
    this.renderLaser();
    this.renderRemoteCursors();
  };

  window.addEventListener("load", function () {
    const engine = new CanvasEngine();
    engine.init().catch(function () {
      engine.setSaveStatus("Init failed");
    });
  });
})();
