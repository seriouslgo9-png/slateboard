const MAX_POINTS = 500;

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
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function simplifyStrokePoints(points) {
  if (points.length <= MAX_POINTS) {
    return points;
  }

  const preservedHead = points.slice(0, 40);
  const simplifiedTail = ramerDouglasPeucker(points.slice(40), 0.85);
  return [...preservedHead, ...simplifiedTail].slice(0, MAX_POINTS);
}

export function createStrokeStyle(style) {
  return {
    color: style.color,
    width: Number(style.width),
    opacity: Number(style.opacity),
  };
}

export function createStroke(tool, style) {
  return {
    id: crypto.randomUUID(),
    tool,
    style: createStrokeStyle(style),
    points: [],
    createdAt: Date.now(),
  };
}

export function appendPointToStroke(stroke, point) {
  const previous = stroke.points[stroke.points.length - 1];
  const timestamp = point.t ?? performance.now();
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

  const nextPoint = {
    x: point.x,
    y: point.y,
    pressure,
    t: timestamp,
  };

  stroke.points = simplifyStrokePoints([...stroke.points, nextPoint]);
  return nextPoint;
}

function drawDot(ctx, point, style) {
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(style.width * point.pressure * 0.5, 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPenStroke(ctx, stroke) {
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

export const toolRegistry = {
  pen: {
    cursor: "crosshair",
    createStroke(style) {
      return createStroke("pen", style);
    },
    appendPoint(stroke, point) {
      return appendPointToStroke(stroke, point);
    },
    draw(ctx, stroke) {
      drawPenStroke(ctx, stroke);
    },
  },
};
