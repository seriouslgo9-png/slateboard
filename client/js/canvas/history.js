const STORAGE_KEY = "slateboard.phase1.history";

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

export function createAddStrokeCommand(stroke) {
  const payload = {
    stroke: structuredClone(stroke),
  };

  return {
    type: "add-stroke",
    payload,
    apply(target) {
      target.addStroke(structuredClone(payload.stroke));
    },
    revert(target) {
      target.removeStroke(payload.stroke.id);
    },
  };
}

export class HistoryManager {
  constructor(target) {
    this.target = target;
    this.past = [];
    this.future = [];
  }

  execute(command, options = {}) {
    command.apply(this.target);

    if (!options.skipRecord) {
      this.past.push(command);
      this.future = [];
      this.persist();
    }
  }

  undo() {
    const command = this.past.pop();

    if (!command) {
      return false;
    }

    command.revert(this.target);
    this.future.push(command);
    this.persist();
    return true;
  }

  redo() {
    const command = this.future.pop();

    if (!command) {
      return false;
    }

    command.apply(this.target);
    this.past.push(command);
    this.persist();
    return true;
  }

  persist() {
    const snapshot = {
      past: this.past.map(serializeCommand),
      future: this.future.map(serializeCommand),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  restore() {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      this.past = (parsed.past || []).map(deserializeCommand).filter(Boolean);
      this.future = (parsed.future || []).map(deserializeCommand).filter(Boolean);
    } catch (error) {
      console.error("Unable to restore history", error);
      this.past = [];
      this.future = [];
    }
  }
}
