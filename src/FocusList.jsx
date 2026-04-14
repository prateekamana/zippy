import { useState, useEffect, useRef } from "react";

export const FOCUS_KEY = "focusList";

export function getFocusList() {
  try { return JSON.parse(localStorage.getItem(FOCUS_KEY)) || []; }
  catch { return []; }
}

export function saveFocusList(ids) {
  localStorage.setItem(FOCUS_KEY, JSON.stringify(ids));
}

const SHEET_ID = '1SHSRxATYjYQTuf5zdbBP2Q0KZvQl7kLo6WhSBNTwyFQ';

function statusBadgeClass(status) {
  if (!status) return "badge badge-status-default";
  const s = status.toLowerCase();
  if (s === "resolved") return "badge badge-status-resolved";
  if (s === "ready for testing") return "badge badge-status-testing";
  if (s === "ready for deployment") return "badge badge-status-ready-for-deployment";
  if (s === "internal testing") return "badge badge-status-internal-testing";
  if (s.includes("progress") || s.includes("in process")) return "badge badge-status-progress";
  if (s === "need clarity") return "badge badge-status-discussion";
  if (s === "on hold") return "badge badge-status-hold";
  if (s === "blocked") return "badge badge-status-blocked";
  return "badge badge-status-default";
}

function priorityBadgeClass(priority) {
  if (!priority) return ["badge badge-priority-default", "dot"];
  const p = priority.toLowerCase();
  if (p.includes("high") || p === "critical") return ["badge badge-high", "dot dot-high"];
  if (p === "medium") return ["badge badge-med", "dot dot-med"];
  if (p === "low") return ["badge badge-low", "dot dot-low"];
  return ["badge badge-default", "dot dot-default"];
}

function formatDate(value) {
  if (!value) return "";
  const iso = value.includes("T") ? value : value + "T00:00:00";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function openSheet(url) {
  if (window.electron?.openExternal) {
    window.electron.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

export default function FocusList() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [focusIds, setFocusIds] = useState(getFocusList);

  // State drives visuals; refs drive drop logic (no stale closure risk)
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const draggingRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    fetch("/api/tasks").then(r => r.json()).then(setTasks).catch(console.error);
    fetch("/api/projects").then(r => r.json()).then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    setFocusIds(getFocusList());
  }, []);

  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const projectGidMap = Object.fromEntries(projects.map(p => [p.id, p.gid]));

  function sheetUrl(task) {
    const gid = projectGidMap[task.project_id];
    if (gid == null || !task.sheet_row) return null;
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${gid}&range=A${task.sheet_row}`;
  }

  const focusTasks = focusIds
    .map(id => tasks.find(t => t.id === id))
    .filter(Boolean);

  function remove(id) {
    const next = focusIds.filter(fid => fid !== id);
    setFocusIds(next);
    saveFocusList(next);
  }

  function handleDragStart(e, index) {
    draggingRef.current = index;
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    // Ghost item still receives pointer events — ignore it so it can't corrupt dropRef
    if (index === draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAt = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    if (dropRef.current !== insertAt) {
      dropRef.current = insertAt;
      setDropIndex(insertAt);
    }
  }

  function doReorder() {
    const from = draggingRef.current;
    const to = dropRef.current;
    reset();
    if (from === null || to === null) return;
    if (to === from || to === from + 1) return;
    setFocusIds(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      next.splice(insertAt, 0, moved);
      saveFocusList(next);
      return next;
    });
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation(); // prevent bubble to fl-list triggering a second doReorder
    doReorder();
  }

  // Fallback: if drop fired outside list bounds, browser cancels it but dragend still fires.
  // doReorder reads refs (not cleared yet) and executes. If handleDrop already ran, refs are
  // null → early return, no double execution.
  function handleDragEnd() {
    doReorder();
  }

  function reset() {
    draggingRef.current = null;
    dropRef.current = null;
    setDraggingIndex(null);
    setDropIndex(null);
  }

  function showIndicator(i) {
    if (dropIndex === null || draggingRef.current === null) return false;
    if (dropIndex !== i) return false;
    // Hide when dropping in no-op position
    const from = draggingRef.current;
    return i !== from && i !== from + 1;
  }

  if (tasks.length === 0 && focusIds.length > 0) {
    return <div className="fl-empty">Loading…</div>;
  }

  return (
    <div className="fl-container">
      <div className="fl-header">
        <h1 className="fl-title">Focus List</h1>
        <span className="fl-count">{focusTasks.length} task{focusTasks.length !== 1 ? "s" : ""}</span>
      </div>

      {focusTasks.length === 0 ? (
        <div className="fl-empty">
          No tasks yet. Star (☆) a task from the main view to add it here.
        </div>
      ) : (
        <div className="fl-list" onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
          {showIndicator(0) && <div className="fl-drop-indicator" />}
          {focusTasks.map((task, index) => (
            <div key={task.id}>
              <div
                className={`fl-item${draggingIndex === index ? " fl-item-ghost" : ""}`}
                draggable
                onDragStart={e => handleDragStart(e, index)}
                onDragOver={e => handleDragOver(e, index)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              >
                <span className="fl-drag-handle" title="Drag to reorder">⠿</span>
                <span className="fl-index">{index + 1}</span>

                <div className="task-pill fl-task-pill">
                  {projectNames[task.project_id] && (
                    <div className="pill-section s-project">
                      <span className="pill-value pill-project-name">{projectNames[task.project_id]}</span>
                    </div>
                  )}
                  <div className="pill-section s-due">
                    <span className="pill-value">{formatDate(task.due_date)}</span>
                  </div>
                  <div className="pill-section s-assign">
                    <span className="pill-value">{task.assignee}</span>
                  </div>
                  <div className="pill-section s-prio">
                    <span className="pill-value">
                      <span className={priorityBadgeClass(task.priority)[0]}>
                        <span className={priorityBadgeClass(task.priority)[1]}></span>
                        {task.priority}
                      </span>
                    </span>
                  </div>
                  <div className="pill-section s-status">
                    <span className="pill-value">
                      <span className={statusBadgeClass(task.status)}>{task.status}</span>
                    </span>
                  </div>
                  <div className="pill-section s-desc">
                    <span className="pill-value pill-value-wrap">{task.description}</span>
                  </div>
                  {sheetUrl(task) && (
                    <div className="pill-section s-sheet-link">
                      <button
                        type="button"
                        className="sheet-link"
                        title="Open in Google Sheets"
                        onClick={() => openSheet(sheetUrl(task))}
                      >
                        ↗
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="fl-remove-btn"
                  title="Remove from Focus List"
                  onClick={() => remove(task.id)}
                >
                  ✕
                </button>
              </div>
              {showIndicator(index + 1) && <div className="fl-drop-indicator" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
